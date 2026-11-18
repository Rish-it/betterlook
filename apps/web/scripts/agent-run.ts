import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {RUNNER_CONFIG} from '../src/lib/agent/config';
import {languageModel} from '../src/lib/agent/model';
import {MODELS, providerOf} from '../src/lib/agent/models';
import {evalCredential, parseTaskMarkdown, parseTasks, previewScreenshot, runTasks} from '../src/lib/agent/runner';
import {flushTraces} from '../src/lib/agent/trace';
import {createProject, sandboxConfigured} from '../src/lib/sandbox/sandbox';

const {values} = parseArgs({
  options: {
    tasks: {type: 'string'},
    runs: {type: 'string', default: '1'},
    concurrency: {type: 'string', default: String(RUNNER_CONFIG.concurrency)},
    model: {type: 'string', default: MODELS[0].id},
    out: {type: 'string', default: `.scratch/agent-runs/${new Date().toISOString().replace(/[:.]/g, '-')}`},
  },
});

const cwd = process.env.INIT_CWD ?? process.cwd();
if (!values.tasks) throw new Error('Usage: bun run agent:run --tasks <file.md|file.json> --runs <k> [--concurrency n] [--model id] [--out dir]');
if (!sandboxConfigured()) throw new Error('Set the Vercel sandbox credentials in apps/web/.env.');
const taskText = readFileSync(resolve(cwd, values.tasks), 'utf8');
const tasks = values.tasks.endsWith('.md') ? parseTaskMarkdown(taskText) : parseTasks(JSON.parse(taskText));
const provider = providerOf(values.model);
if (!provider) throw new Error(`Unknown model ${values.model}. Pick one of: ${MODELS.map(m => m.id).join(', ')}.`);
const credential = evalCredential(provider, process.env);
const outDir = resolve(cwd, values.out);

const results = await runTasks({
  tasks,
  runs: Number(values.runs),
  concurrency: Number(values.concurrency),
  outDir,
  model: () => languageModel(values.model, credential),
  project: () => createProject(),
  capture: project => previewScreenshot(project),
  log: line => console.log(line),
});
await flushTraces();
console.log(`${results.length} runs written to ${outDir}`);
