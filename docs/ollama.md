# Reading receipts with Ollama, on your own computer

[Deutsch](ollama.de.md)

With a local model, **no receipt text leaves your computer**: the bridge sends it to [Ollama](https://ollama.com) on `127.0.0.1` instead of a provider on the internet. It costs nothing but time and disk space. This page sets it up on a Mac; on Linux and Windows the steps are the same, only the way Ollama is started differs.

What the model does and what is sent is in [ai.md](ai.md).

## 1. What to download

1. **Ollama itself**: [ollama.com/download](https://ollama.com/download), or `brew install --cask ollama`. Start the app once; it runs in the menu bar and answers on `http://127.0.0.1:11434`.
2. **One model** that fits your memory. Belege needs a model that answers in JSON without "thinking" first (a reasoning model spends minutes per receipt on a CPU) and reads German, English and other languages:

   | Your computer        | Model                                | Download | Note                                                                                           |
   | -------------------- | ------------------------------------ | -------- | ---------------------------------------------------------------------------------------------- |
   | 32 GB memory or more | `qwen3:30b-a3b-instruct-2507-q4_K_M` | 18 GB    | Our pick. A mixture of experts: about 3B parameters work per word, so it is fast for its size. |
   | 16 GB memory         | `qwen3:4b-instruct-2507-q4_K_M`      | 2.5 GB   | Faster, weaker: several VAT rates, long or foreign receipts go wrong more often.               |

   ```bash
   ollama pull qwen3:30b-a3b-instruct-2507-q4_K_M
   ```

   Keep 20 GB free on the disk for the larger one. Models you no longer use: `ollama list`, then `ollama rm <name>`.

## 2. Two settings for Ollama

Ollama cuts long texts **silently** at its default context, and unloads the model after five idle minutes (loading 18 GB again takes a minute). Set both once, then quit Ollama in the menu bar and start it again:

```bash
launchctl setenv OLLAMA_CONTEXT_LENGTH 16384
launchctl setenv OLLAMA_KEEP_ALIVE 2h
```

`launchctl setenv` holds until the Mac restarts; after a restart, run both again before starting Ollama. To see what the running Ollama uses: `ollama ps` shows the model, its context and whether it runs on the CPU or a GPU.

## 3. The bridge

```bash
pnpm setup:llm
```

| Question            | Answer                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| LLM base URL        | `http://127.0.0.1:11434/v1`                                                  |
| Model               | the name from step 1, e.g. `qwen3:30b-a3b-instruct-2507-q4_K_M`              |
| Model for the retry | the same name (or the small model, if both are downloaded)                   |
| Terms to black out  | Enter keeps yours. Nothing leaves anyway; the terms do no harm.              |
| API key             | Enter. Ollama needs none; a key stored for another provider stays for later. |

Then restart the bridge (`pnpm bridge`). In the app, _Integrationen → KI – Beleg-Auslesen_ shows the provider `127.0.0.1:11434` and the model.

## 4. In Belege

- _Statistik → Gleichzeitige KI-Anfragen je Lauf_: **1**. On a CPU Ollama answers one request at a time; a second one only waits behind it.
- _Belege → Alle neuen auslesen_ reads the waiting receipts. Let it run; it shows where it is on the Belege tab and can be cancelled.

## How fast, how good

Measured 2026-10-15 on an Intel Mac (i9, 32 GB, CPU only – Ollama uses no AMD graphics on a Mac) with `qwen3:30b-a3b-instruct-2507-q4_K_M` and Belege's own request:

| Made-up receipt                     | Time  | Read                                      |
| ----------------------------------- | ----- | ----------------------------------------- |
| German invoice (PDF text)           | 121 s | all fields right                          |
| Till receipt (OCR text from a scan) | 129 s | all fields right                          |
| Russian train ticket                | 154 s | right; the means of transport was guessed |

**About two minutes per receipt**: a few hundred receipts are a night. The first receipt after Ollama started also loads the model. The bridge waits up to 10 minutes for a model on this computer. A Mac with Apple silicon runs the model on its GPU and should be much faster; we have not measured it yet.

## When something goes wrong

| What the app says                              | What to do                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| "Ollama ist nicht erreichbar …"                | Ollama is not running: start the app, then "Weitermachen" on Home.                              |
| "Ollama kennt das eingestellte Modell nicht …" | The name in `pnpm setup:llm` differs from `ollama list`; correct it, restart the bridge.        |
| A receipt: "no answer within 600 s"            | The computer is busy, or the receipt is very long. Read it again later on its own (_Auslesen_). |
| Long receipts come back half-read              | `OLLAMA_CONTEXT_LENGTH` is not set in the running Ollama (step 2; check with `ollama ps`).      |

Back to a provider on the internet: `pnpm setup:llm` again with its URL and models, then restart the bridge.
