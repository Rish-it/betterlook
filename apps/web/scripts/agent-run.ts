import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {RUNNER_CONFIG} from '../src/lib/agent/config';
import {languageModel} from '../src/lib/agent/model';
import {MODELS} from '../src/lib/agent/models';
import {evalCredential, parseTasks, previewScreenshot, runTasks} from '../src/lib/agent/runner';
import {flushTraces} from '../src/lib/agent/trace';
import {createSandbox, openProject, sandboxConfigured} from '../src/lib/sandbox/sandbox';

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
if (!values.tasks) throw new Error('Usage: bun run agent:run --tasks <file.json> --runs <k> [--concurrency n] [--model id] [--out dir]');
if (!sandboxConfigured()) throw new Error('Set the Vercel sandbox credentials in apps/web/.env.');
const tasks = parseTasks(JSON.parse(readFileSync(resolve(cwd, values.tasks), 'utf8')));
const credential = evalCredential(process.env);
const outDir = resolve(cwd, values.out);

const results = await runTasks({
  tasks,
  runs: Number(values.runs),
  concurrency: Number(values.concurrency),
  outDir,
  model: () => languageModel(values.model, credential),
  project: async () => openProject((await createSandbox()).sandboxId),
  capture: project => previewScreenshot(project),
  log: line => console.log(line),
});
await flushTraces();
console.log(`${results.length} runs written to ${outDir}`);
