// The contract without a TEE: the owner names a test submitter, which registers a bridge with a
// mock attestation. The real quote check is shade-attestation's own (tested there); here: who may
// ask, what a registration answers, what the browser reads.

use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::testing_env;
use shade_attestation::attestation::create_mock_dstack_attestation;

const LAUNCHER: &str = "launcher.le-space.testnet";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(by: &str, deposit: NearToken, now_ms: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("bridge-agent.testnet"))
        .predecessor_account_id(acc(by))
        .attached_deposit(deposit)
        .block_timestamp(now_ms * 1_000_000)
        .build());
}

fn none() -> NearToken {
    NearToken::from_yoctonear(0)
}

fn key_hash(b: u8) -> KeyHash {
    HexBytes::from([b; 32])
}

/// Owner le-space.testnet, no TEE, the mock measurements and PPID approved, LAUNCHER may submit.
fn contract() -> Contract {
    ctx("bridge-agent.testnet", none(), 1_000);
    let mut c = Contract::new(acc("le-space.testnet"), false, U64(60_000));
    ctx("le-space.testnet", none(), 1_000);
    c.approve_measurements(create_mock_full_measurements_hex());
    c.approve_ppids(vec![Ppid::default()]);
    c.add_test_submitter(acc(LAUNCHER));
    c
}

fn started(c: &mut Contract) {
    ctx("books-a.testnet", STORAGE_DEPOSIT, 2_000);
    assert_eq!(c.request_start(None), U64(2_000));
}

fn register(c: &mut Contract, now: u64) -> BridgeView {
    ctx(LAUNCHER, none(), now);
    c.register_bridge(acc("books-a.testnet"), create_mock_dstack_attestation(), key_hash(7))
}

#[test]
fn the_books_ask_for_a_start_and_the_launcher_sees_it() {
    let mut c = contract();
    started(&mut c);
    let log = get_logs().join("\n");
    assert!(log.contains(r#""event":"start_requested""#), "{log}");
    assert!(log.contains(r#""books":"books-a.testnet""#), "{log}");
    assert!(log.contains(r#""at_ms":"2000""#), "{log}");
    let view = c.get_books(acc("books-a.testnet")).unwrap();
    assert_eq!(view.request.unwrap().kind, RequestKind::Start);
    assert!(view.bridge.is_none());
}

#[test]
#[should_panic(expected = "for the books' storage")]
fn new_books_pay_their_storage() {
    let mut c = contract();
    ctx("books-a.testnet", none(), 2_000);
    c.request_start(None);
}

#[test]
#[should_panic(expected = "Not granted for these books")]
fn a_stranger_cannot_start_someone_elses_bridge() {
    let mut c = contract();
    started(&mut c);
    ctx("stranger.testnet", none(), 40_000);
    c.request_start(Some(acc("books-a.testnet")));
}

#[test]
fn a_granted_agent_can_wake_the_bridge_until_revoked() {
    let mut c = contract();
    ctx("books-a.testnet", STORAGE_DEPOSIT, 2_000);
    c.grant(acc("assistant.testnet"));
    ctx("assistant.testnet", none(), 3_000);
    c.request_start(Some(acc("books-a.testnet")));
    assert_eq!(c.get_books(acc("books-a.testnet")).unwrap().request.unwrap().by, acc("assistant.testnet"));
    ctx("books-a.testnet", none(), 4_000);
    c.revoke(acc("assistant.testnet"));
    assert!(c.get_books(acc("books-a.testnet")).unwrap().grants.is_empty());
}

#[test]
#[should_panic(expected = "Too soon after the last request")]
fn requests_are_rate_limited() {
    let mut c = contract();
    started(&mut c);
    ctx("books-a.testnet", none(), 2_000 + REQUEST_GAP_MS - 1);
    c.request_stop(None);
}

#[test]
fn a_bridge_answers_the_start_and_the_browser_reads_its_key() {
    let mut c = contract();
    started(&mut c);
    let view = register(&mut c, 3_000);
    assert!(view.valid);
    assert_eq!(view.intake_key_hash, "07".repeat(32));
    assert_eq!(view.start_at_ms, U64(2_000));
    let books = c.get_books(acc("books-a.testnet")).unwrap();
    assert!(books.request.is_none(), "the start was answered");
    assert_eq!(books.bridge.unwrap(), view);
    assert!(get_logs().join("\n").contains(r#""event":"bridge_registered""#));
    // It expires.
    ctx("anyone.testnet", none(), 3_000 + 60_001);
    assert!(!c.get_books(acc("books-a.testnet")).unwrap().bridge.unwrap().valid);
}

#[test]
#[should_panic(expected = "did not ask for a start")]
fn a_start_is_answered_once() {
    let mut c = contract();
    started(&mut c);
    register(&mut c, 3_000);
    register(&mut c, 4_000);
}

#[test]
#[should_panic(expected = "did not ask for a start")]
fn no_bridge_for_books_that_did_not_ask() {
    let mut c = contract();
    ctx("books-a.testnet", STORAGE_DEPOSIT, 2_000);
    c.grant(acc("assistant.testnet"));
    register(&mut c, 3_000);
}

#[test]
#[should_panic(expected = "Not a test submitter")]
fn without_a_tee_only_the_named_submitter_registers() {
    let mut c = contract();
    started(&mut c);
    ctx("someone.testnet", none(), 3_000);
    c.register_bridge(acc("books-a.testnet"), create_mock_dstack_attestation(), key_hash(7));
}

#[test]
fn stop_forgets_the_bridge_at_once() {
    let mut c = contract();
    started(&mut c);
    register(&mut c, 3_000);
    ctx("books-a.testnet", none(), 2_000 + REQUEST_GAP_MS);
    c.request_stop(None);
    let books = c.get_books(acc("books-a.testnet")).unwrap();
    assert!(books.bridge.is_none());
    assert_eq!(books.request.unwrap().kind, RequestKind::Stop);
    assert!(get_logs().join("\n").contains(r#""reason":"stop""#));
}

#[test]
fn a_bridge_is_invalid_once_its_measurements_are_withdrawn() {
    let mut c = contract();
    started(&mut c);
    register(&mut c, 3_000);
    ctx("le-space.testnet", none(), 4_000);
    c.remove_measurements(create_mock_full_measurements_hex());
    assert!(!c.get_books(acc("books-a.testnet")).unwrap().bridge.unwrap().valid);
}

#[test]
#[should_panic(expected = "Only the owner")]
fn only_the_owner_approves_code() {
    let mut c = contract();
    ctx("books-a.testnet", none(), 2_000);
    c.approve_measurements(create_mock_full_measurements_hex());
}

#[test]
fn the_report_data_binds_the_start_and_the_node_key() {
    ctx("anyone.testnet", none(), 1);
    let data = expected_report_data(&acc("books-a.testnet"), 2_000, &key_hash(9));
    assert_eq!(
        hex::encode(&data[..32]),
        hex::encode(env::sha256_array(b"belege-bridge/start/1books-a.testnet:2000"))
    );
    assert_eq!(&data[32..], &[9u8; 32]);
    // The same vector as bridge/test/tee-dstack.test.js: the VM and the contract agree.
    assert_eq!(
        hex::encode(data),
        "243ffdb70c9e7f9fd91e12cc544d57e50bbcc66a37c954cf12bd70a2a2d0a8a2\
         0909090909090909090909090909090909090909090909090909090909090909"
    );
    assert_ne!(data, expected_report_data(&acc("books-a.testnet"), 2_001, &key_hash(9)));
    assert_ne!(data, expected_report_data(&acc("books-b.testnet"), 2_000, &key_hash(9)));
}

#[test]
fn the_launcher_lists_open_requests_and_answers_a_stop() {
    let mut c = contract();
    ctx("le-space.testnet", none(), 1_500);
    c.add_launcher(acc(LAUNCHER));
    started(&mut c);
    let open = c.get_requests(None, None);
    assert_eq!(open.len(), 1);
    assert_eq!(open[0]["books"], "books-a.testnet");
    assert_eq!(open[0]["request"]["kind"], "Start");
    ctx("books-a.testnet", none(), 2_000 + REQUEST_GAP_MS);
    let at = c.request_stop(None);
    ctx(LAUNCHER, none(), 40_000);
    c.ack_request(acc("books-a.testnet"), at, "stopped".into());
    assert!(c.get_requests(None, None).is_empty());
    assert!(get_logs().join("\n").contains(r#""event":"request_answered""#));
}

#[test]
#[should_panic(expected = "No such request")]
fn an_ack_must_name_the_open_request() {
    let mut c = contract();
    ctx("le-space.testnet", none(), 1_500);
    c.add_launcher(acc(LAUNCHER));
    started(&mut c);
    ctx(LAUNCHER, none(), 3_000);
    c.ack_request(acc("books-a.testnet"), U64(1_999), "stopped".into());
}

#[test]
#[should_panic(expected = "Only a launcher")]
fn only_a_launcher_answers_requests() {
    let mut c = contract();
    started(&mut c);
    ctx("someone.testnet", none(), 3_000);
    c.ack_request(acc("books-a.testnet"), U64(2_000), "stopped".into());
}
