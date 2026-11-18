import {posix} from 'node:path';
import {AGENT_CONFIG} from './config';
import type {DeniedCall} from './types';

export type PolicyDecision =
  | {type: 'allow'; path?: string}
  | {type: 'approve'; path: string}
  | {type: 'deny'; reason: DeniedCall['reason']; message: string};

const WRITE_TOOLS: string[] = ['edit_file', 'write_file'];
const globToRegExp = (glob: string) =>
  new RegExp(`^${glob.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
const APPROVAL_FILES = AGENT_CONFIG.approvalFiles.map(globToRegExp);

export function checkPolicy(tool: string, input: unknown, root: string): PolicyDecision {
  if (!(AGENT_CONFIG.tools as readonly string[]).includes(tool)) {
    return {type: 'deny', reason: 'not-allowlisted', message: `The ${tool} tool is not allowed.`};
  }
  const path = (input as {path?: unknown} | null)?.path;
  if (path === undefined) return {type: 'allow'};
  if (typeof path !== 'string') return {type: 'deny', reason: 'outside-project', message: 'The path must be a string.'};

  const rel = posix.relative(root, posix.resolve(root, path));
  if (rel === '..' || rel.startsWith('../') || posix.isAbsolute(rel)) {
    return {type: 'deny', reason: 'outside-project', message: `${path} is outside the project folder.`};
  }
  if ((AGENT_CONFIG.deniedPaths as readonly string[]).includes(rel.split('/')[0])) {
    return {type: 'deny', reason: 'outside-project', message: `${path} is not part of the editable project.`};
  }
  if (WRITE_TOOLS.includes(tool) && APPROVAL_FILES.some(re => re.test(posix.basename(rel)))) {
    return {type: 'approve', path: rel};
  }
  return {type: 'allow', path: rel};
}
