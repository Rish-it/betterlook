import {expect, test} from 'bun:test';
import {projectTitle} from './title';

test('a title is the first words of the first sentence, in sentence case', () => {
  expect(projectTitle('make the hero headline larger and center the sign-up button.')).toBe('Make the hero headline larger and');
  expect(projectTitle('Use a darker navbar. Then round the cards')).toBe('Use a darker navbar');
  expect(projectTitle('  swap the logo for SVG,\nand fix spacing')).toBe('Swap the logo for SVG');
  expect(projectTitle('Bump padding to 1.5rem on cards')).toBe('Bump padding to 1.5rem on cards');
});

test('a long title is cut at a word, and an empty prompt keeps the default', () => {
  expect(projectTitle('Internationalization accessibility responsiveness everywhere please')).toBe('Internationalization accessibility');
  expect(projectTitle('a'.repeat(60))).toBe('A'.concat('a'.repeat(39)));
  expect(projectTitle(' ... ')).toBe('Untitled project');
});
