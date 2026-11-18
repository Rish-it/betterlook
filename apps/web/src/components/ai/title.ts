const MAX_WORDS = 6;
const MAX_CHARS = 40;
export const UNTITLED = 'Untitled project';

export function projectTitle(prompt: string) {
  const sentence = prompt.trim().split(/[.!?](?:\s|$)|\n/)[0];
  const words = sentence.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  while (words.length > 1 && words.join(' ').length > MAX_CHARS) words.pop();
  const title = words.join(' ').slice(0, MAX_CHARS).replace(/[\s\p{P}]+$/u, '');
  return title ? title[0].toUpperCase() + title.slice(1) : UNTITLED;
}
