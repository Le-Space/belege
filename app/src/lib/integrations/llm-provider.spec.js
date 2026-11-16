// The KI page's provider line and the steps when Ollama is missing, from a
// made-up /llm/status answer.
import { afterEach, describe, expect, it } from 'vitest';

import { setLocale } from '../i18n/index.js';
import { countryName, ollamaHelp, providerText } from './llm-provider.js';

afterEach(() => setLocale('de'));

describe('providerText', () => {
	it('names a provider on the internet with its country, in the reader’s language', () => {
		const status = {
			providerInfo: { id: 'deepseek', name: 'DeepSeek', country: 'CN', local: false }
		};
		setLocale('en');
		expect(providerText(status, 'en')).toBe('DeepSeek – China');
		setLocale('de');
		expect(providerText(status, 'de')).toBe('DeepSeek – China');
		expect(
			providerText(
				{ providerInfo: { id: 'openai', name: 'OpenAI', country: 'US', local: false } },
				'de'
			)
		).toBe('OpenAI – Vereinigte Staaten');
	});

	it('a model on this computer says so; an unknown country says that; LibertAI as it is', () => {
		setLocale('en');
		expect(
			providerText(
				{ providerInfo: { id: 'ollama', name: 'Ollama', country: null, local: true } },
				'en'
			)
		).toBe('Ollama – on this computer');
		expect(
			providerText(
				{
					providerInfo: { id: 'other', name: 'llm.example.com', country: null, local: false }
				},
				'en'
			)
		).toBe('llm.example.com – country unknown');
		expect(
			providerText(
				{ providerInfo: { id: 'libertai', name: 'LibertAI', country: null, local: false } },
				'en'
			)
		).toBe('LibertAI');
		// An older bridge says nothing about it.
		expect(providerText({ provider: 'api.example.com' }, 'en')).toBeNull();
		expect(providerText(null, 'en')).toBeNull();
	});

	it('countryName falls back to the code', () => {
		expect(countryName('FR', 'en')).toBe('France');
		expect(countryName('not a code', 'en')).toBe('not a code');
	});
});

describe('ollamaHelp', () => {
	const model = 'made-up-model:4b';

	it('Ollama not running: install, pull the model, start – and no model elsewhere instead', () => {
		setLocale('en');
		const help = ollamaHelp({ ollama: { state: 'unreachable', model } });
		expect(help?.message).toMatch(/not installed or not running/);
		expect(help?.message).toMatch(/no model on the internet is used instead/);
		expect(help?.steps).toHaveLength(3);
		expect(help?.steps[0]).toMatch(/ollama\.com\/download/);
		expect(help?.steps[1]).toBe(`Download the model: ollama pull ${model}`);
		expect(help?.steps[2]).toMatch(/restart the bridge/);
	});

	it('the model not pulled: only that, in German too', () => {
		setLocale('de');
		const help = ollamaHelp({ ollama: { state: 'model-missing', model } });
		expect(help?.message).toBe(`Ollama läuft, aber das Modell ${model} ist noch nicht geladen.`);
		expect(help?.steps[0]).toBe(`Das Modell laden: ollama pull ${model}`);
	});

	it('nothing to say when Ollama runs or is not the model', () => {
		expect(ollamaHelp({ ollama: { state: 'running', model } })).toBeNull();
		expect(ollamaHelp({ ollama: null })).toBeNull();
		expect(ollamaHelp(null)).toBeNull();
	});
});
