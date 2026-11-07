// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The hosted bridge's contract on NEAR (#696).
//
// It answers three questions anyone can check on chain:
//
// 1. Which bridge code is approved? The owner (Le Space) approves the TDX
//    measurements per release – RTMRs, the key provider and the compose hash
//    as Phala provisions it – and the Phala machines (PPIDs) it may run on.
// 2. Who asked to start or stop the bridge of some books? The books' own NEAR
//    account, or an account it granted (another agent). The Le Space launcher
//    acts on the events; nothing secret is stored here.
// 3. Which VM answered that start, and under which key does it take its
//    secrets? The VM boots without them, makes an X25519 key of its own and a
//    dstack quote whose report data is
//      SHA-256("belege-bridge/start/1" ‖ books ‖ ":" ‖ the request's time)
//      ‖ SHA-256 of that X25519 public key
//    and hands it out (it has no NEAR key and no money); anyone may submit it,
//    the launcher does. The contract checks the quote (NEAR's
//    shade-attestation: DCAP, RTMR3 replay, compose hash, PPID) against the
//    pending start of those books, so a quote answers one start only. Only
//    then does the browser encrypt the bridge's secrets to that key: they
//    reach this attested VM and no other. The bridge's node key is one of
//    those secrets, so its peer id, which the browser knows, proves the VM.
//
// Made after NEAR's Shade Agent template (NearDeFi/shade-agent-template,
// Apache-2.0); the attestation check is its crate, used as it is.

use near_sdk::{
    AccountId, BorshStorageKey, NearToken, PanicOnDefault,
    env::{self, block_timestamp_ms},
    json_types::U64,
    near, require,
    serde_json::{self, json},
    store::{IterableMap, IterableSet},
};
use shade_attestation::{
    attestation::DstackAttestation,
    measurements::{FullMeasurements, FullMeasurementsHex, create_mock_full_measurements_hex},
    report_data::ReportData,
    tcb_info::HexBytes,
};

pub type Ppid = HexBytes<16>;
pub type KeyHash = HexBytes<32>;

/// At most this many accounts may start the bridge of one set of books besides its own.
pub const MAX_GRANTS: usize = 8;
/// A new request of the same books waits this long after the last one.
pub const REQUEST_GAP_MS: u64 = 30_000;
/// What one set of books costs in storage; paid once, with its first request or grant.
pub const STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(10);
/// The domain of the start binding in a quote's report data.
pub const START_DOMAIN: &str = "belege-bridge/start/1";

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestKind {
    Start,
    Stop,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub kind: RequestKind,
    pub by: AccountId,
    pub at_ms: U64,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Bridge {
    pub intake_key_hash: KeyHash,
    pub measurements: FullMeasurementsHex,
    pub ppid: Ppid,
    /// the start it answered
    pub start_at_ms: u64,
    pub registered_ms: u64,
    pub valid_until_ms: u64,
}

#[near(serializers = [borsh])]
pub struct Books {
    pub grants: Vec<AccountId>,
    pub request: Option<Request>,
    pub bridge: Option<Bridge>,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq, Eq)]
pub struct BridgeView {
    /// hex SHA-256 of the X25519 key the VM takes the bridge's secrets under
    pub intake_key_hash: String,
    /// hex compose hash the VM runs, as Phala provisioned it
    pub compose_hash: String,
    pub start_at_ms: U64,
    pub registered_ms: U64,
    pub valid_until_ms: U64,
    /// still approved and not expired: only then may a browser pair with it
    pub valid: bool,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq, Eq)]
pub struct BooksView {
    pub grants: Vec<AccountId>,
    pub request: Option<Request>,
    pub bridge: Option<BridgeView>,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Measurements,
    Ppids,
    Books,
    TestSubmitters,
    Launchers,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub owner_id: AccountId,
    /// false only on a test network without TDX: submitters the owner named register with a mock
    pub requires_tee: bool,
    pub attestation_ttl_ms: u64,
    pub approved_measurements: IterableSet<FullMeasurementsHex>,
    pub approved_ppids: IterableSet<Ppid>,
    pub books: IterableMap<AccountId, Books>,
    pub test_submitters: IterableSet<AccountId>,
    /// who may answer a request that did not end in a registered bridge (a stop, a failed start)
    pub launchers: IterableSet<AccountId>,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "belege-bridge", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

/// The 64 bytes a bridge's quote must carry to answer the start of `books` at `start_at_ms`.
pub fn expected_report_data(books: &AccountId, start_at_ms: u64, intake_key_hash: &KeyHash) -> [u8; 64] {
    let binding = format!("{START_DOMAIN}{books}:{start_at_ms}");
    let mut data = [0u8; 64];
    data[..32].copy_from_slice(&env::sha256_array(binding.as_bytes()));
    data[32..].copy_from_slice(intake_key_hash.as_ref());
    data
}

#[near]
impl Contract {
    #[init]
    #[private]
    pub fn new(owner_id: AccountId, requires_tee: bool, attestation_ttl_ms: U64) -> Self {
        Self {
            owner_id,
            requires_tee,
            attestation_ttl_ms: attestation_ttl_ms.into(),
            approved_measurements: IterableSet::new(StorageKey::Measurements),
            approved_ppids: IterableSet::new(StorageKey::Ppids),
            books: IterableMap::new(StorageKey::Books),
            test_submitters: IterableSet::new(StorageKey::TestSubmitters),
            launchers: IterableSet::new(StorageKey::Launchers),
        }
    }

    // ── The books: who may start and stop their bridge ──────────────────────

    /// Ask for the bridge of `books` (default: the caller's own) to be started. The books' own
    /// account, or one it granted. The first request of new books pays their storage.
    #[payable]
    pub fn request_start(&mut self, books: Option<AccountId>) -> U64 {
        self.request(books, RequestKind::Start)
    }

    /// Ask for the bridge of `books` to be stopped. Its bridge is forgotten at once: no browser
    /// pairs with it from now on, whatever the VM still does.
    #[payable]
    pub fn request_stop(&mut self, books: Option<AccountId>) -> U64 {
        self.request(books, RequestKind::Stop)
    }

    /// Let `account_id` (another agent, a second device) start and stop these books' bridge.
    #[payable]
    pub fn grant(&mut self, account_id: AccountId) {
        let books_id = env::predecessor_account_id();
        let books = self.books_or_create(&books_id);
        if !books.grants.contains(&account_id) {
            require!(books.grants.len() < MAX_GRANTS, "Too many grants");
            books.grants.push(account_id.clone());
        }
        emit("granted", json!({ "books": books_id, "account_id": account_id }));
    }

    pub fn revoke(&mut self, account_id: AccountId) {
        let books_id = env::predecessor_account_id();
        let books = self.books.get_mut(&books_id).expect("No such books");
        books.grants.retain(|a| a != &account_id);
        emit("revoked", json!({ "books": books_id, "account_id": account_id }));
    }

    // ── The bridge's attestation ────────────────────────────────────────────

    /// The quote of the VM that answers the pending start of `books`. Anyone may submit it:
    /// the quote is the proof. Returns what the browser will read.
    pub fn register_bridge(
        &mut self,
        books: AccountId,
        attestation: DstackAttestation,
        intake_key_hash: KeyHash,
    ) -> BridgeView {
        let start_at_ms = {
            let b = self.books.get(&books).expect("No such books");
            match &b.request {
                Some(r) if r.kind == RequestKind::Start => u64::from(r.at_ms),
                _ => env::panic_str("These books did not ask for a start"),
            }
        };
        let (measurements, ppid) = self.verify(&books, start_at_ms, &intake_key_hash, attestation);
        let now = block_timestamp_ms();
        let bridge = Bridge {
            intake_key_hash,
            measurements,
            ppid,
            start_at_ms,
            registered_ms: now,
            valid_until_ms: now + self.attestation_ttl_ms,
        };
        let view = self.view_of(&bridge);
        let b = self.books.get_mut(&books).expect("No such books");
        b.request = None;
        b.bridge = Some(bridge);
        emit(
            "bridge_registered",
            json!({ "books": books, "intake_key_hash": view.intake_key_hash, "compose_hash": view.compose_hash }),
        );
        view
    }

    /// The launcher answers a request that ends without a registration: a stop it carried out,
    /// or a start it could not carry out (`outcome` says why, for the books to read in the event).
    pub fn ack_request(&mut self, books: AccountId, at_ms: U64, outcome: String) {
        require!(self.launchers.contains(&env::predecessor_account_id()), "Only a launcher");
        require!(outcome.len() <= 200, "Outcome too long");
        let b = self.books.get_mut(&books).expect("No such books");
        let kind = match &b.request {
            Some(r) if r.at_ms == at_ms => r.kind,
            _ => env::panic_str("No such request"),
        };
        b.request = None;
        emit(
            "request_answered",
            json!({ "books": books, "at_ms": at_ms, "kind": kind, "outcome": outcome }),
        );
    }

    // ── The owner ───────────────────────────────────────────────────────────

    pub fn add_launcher(&mut self, account_id: AccountId) {
        self.require_owner();
        self.launchers.insert(account_id);
    }

    pub fn remove_launcher(&mut self, account_id: AccountId) {
        self.require_owner();
        self.launchers.remove(&account_id);
    }

    pub fn approve_measurements(&mut self, measurements: FullMeasurementsHex) {
        self.require_owner();
        self.approved_measurements.insert(measurements);
    }

    pub fn remove_measurements(&mut self, measurements: FullMeasurementsHex) {
        self.require_owner();
        self.approved_measurements.remove(&measurements);
    }

    pub fn approve_ppids(&mut self, ppids: Vec<Ppid>) {
        self.require_owner();
        for p in ppids {
            self.approved_ppids.insert(p);
        }
    }

    pub fn remove_ppids(&mut self, ppids: Vec<Ppid>) {
        self.require_owner();
        for p in ppids {
            self.approved_ppids.remove(&p);
        }
    }

    pub fn set_attestation_ttl(&mut self, attestation_ttl_ms: U64) {
        self.require_owner();
        self.attestation_ttl_ms = attestation_ttl_ms.into();
    }

    /// Without TEE only: who may submit a mock attestation (the test launcher).
    pub fn add_test_submitter(&mut self, account_id: AccountId) {
        self.require_owner();
        require!(!self.requires_tee, "Only without TEE");
        self.test_submitters.insert(account_id);
    }

    pub fn forget_bridge(&mut self, books: AccountId) {
        self.require_owner();
        if let Some(b) = self.books.get_mut(&books) {
            if b.bridge.take().is_some() {
                emit("bridge_forgotten", json!({ "books": books, "reason": "owner" }));
            }
        }
    }

    // ── Views ───────────────────────────────────────────────────────────────

    pub fn get_books(&self, books: AccountId) -> Option<BooksView> {
        let b = self.books.get(&books)?;
        Some(BooksView {
            grants: b.grants.clone(),
            request: b.request.clone(),
            bridge: b.bridge.as_ref().map(|br| self.view_of(br)),
        })
    }

    /// The open requests, for the launcher: books, kind, by, time.
    pub fn get_requests(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<serde_json::Value> {
        self.books
            .iter()
            .filter_map(|(id, b)| b.request.as_ref().map(|r| json!({ "books": id, "request": r })))
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100).min(100) as usize)
            .collect()
    }

    pub fn get_launchers(&self) -> Vec<AccountId> {
        self.launchers.iter().cloned().collect()
    }

    pub fn get_approved_measurements(&self) -> Vec<FullMeasurementsHex> {
        self.approved_measurements.iter().cloned().collect()
    }

    pub fn get_approved_ppids(&self) -> Vec<Ppid> {
        self.approved_ppids.iter().cloned().collect()
    }

    pub fn get_info(&self) -> serde_json::Value {
        json!({
            "owner_id": self.owner_id,
            "requires_tee": self.requires_tee,
            "attestation_ttl_ms": U64(self.attestation_ttl_ms),
            "books": self.books.len(),
            "start_domain": START_DOMAIN,
        })
    }
}

impl Contract {
    fn require_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Only the owner");
    }

    fn books_or_create(&mut self, books_id: &AccountId) -> &mut Books {
        if self.books.get(books_id).is_none() {
            require!(
                env::attached_deposit() >= STORAGE_DEPOSIT,
                format!("Attach {} for the books' storage", STORAGE_DEPOSIT.exact_amount_display())
            );
            self.books.insert(books_id.clone(), Books { grants: Vec::new(), request: None, bridge: None });
        }
        self.books.get_mut(books_id).expect("just made")
    }

    fn request(&mut self, books: Option<AccountId>, kind: RequestKind) -> U64 {
        let by = env::predecessor_account_id();
        let books_id = books.unwrap_or_else(|| by.clone());
        let now = block_timestamp_ms();
        let forgot = {
            let b = if books_id == by {
                self.books_or_create(&books_id)
            } else {
                let b = self.books.get_mut(&books_id).expect("No such books");
                require!(b.grants.contains(&by), "Not granted for these books");
                b
            };
            if let Some(last) = &b.request {
                require!(now >= u64::from(last.at_ms) + REQUEST_GAP_MS, "Too soon after the last request");
            }
            b.request = Some(Request { kind, by: by.clone(), at_ms: U64(now) });
            // A stop, and a new start, end the bridge the books knew.
            b.bridge.take().is_some()
        };
        if forgot {
            emit("bridge_forgotten", json!({ "books": books_id, "reason": if kind == RequestKind::Stop { "stop" } else { "restart" } }));
        }
        let event = if kind == RequestKind::Start { "start_requested" } else { "stop_requested" };
        emit(event, json!({ "books": books_id, "by": by, "at_ms": U64(now) }));
        U64(now)
    }

    fn verify(
        &self,
        books: &AccountId,
        start_at_ms: u64,
        intake_key_hash: &KeyHash,
        attestation: DstackAttestation,
    ) -> (FullMeasurementsHex, Ppid) {
        if !self.requires_tee {
            require!(
                self.test_submitters.contains(&env::predecessor_account_id()),
                "Not a test submitter (no TEE on this contract)"
            );
            return (create_mock_full_measurements_hex(), Ppid::default());
        }
        let report_data = ReportData::from(expected_report_data(books, start_at_ms, intake_key_hash));
        let accepted: Vec<FullMeasurements> =
            self.approved_measurements.iter().cloned().map(Into::into).collect();
        let ppids: Vec<Ppid> = self.approved_ppids.iter().cloned().collect();
        match attestation.verify(report_data, block_timestamp_ms() / 1000, &accepted, &ppids) {
            Ok(ok) => (ok.measurements.into(), ok.ppid),
            Err(e) => env::panic_str(&format!("Attestation refused: {e}")),
        }
    }

    fn view_of(&self, b: &Bridge) -> BridgeView {
        let valid = b.valid_until_ms >= block_timestamp_ms()
            && self.approved_measurements.contains(&b.measurements)
            && self.approved_ppids.contains(&b.ppid);
        BridgeView {
            intake_key_hash: hex::encode(b.intake_key_hash.as_ref()),
            compose_hash: hex::encode(b.measurements.app_compose_hash_payload.as_ref()),
            start_at_ms: U64(b.start_at_ms),
            registered_ms: U64(b.registered_ms),
            valid_until_ms: U64(b.valid_until_ms),
            valid,
        }
    }
}

#[cfg(test)]
mod tests;
