import { describe, expect, it } from 'vitest';
import { correctSentence } from '../childGrammarEngine';

const check = (input: string) => correctSentence(`C ${input}`).replace(/^C /, '');

describe('BE agreement: correct sentences are not flagged', () => {
  it.each([
    'The toys that are broken.',
    'I like the dogs that are big.',
    'He and she are playing.',
    'Mom and he are going.',
    'What are you doing?',
    'Are you happy?',
    'Where are the dogs?',
    'They are happy.',
    'The kids are playing.',
    'These are mine.',
    'This is fun.',
    'My shoes are wet.',
    'The news is on.',
    'The boy with the dogs is happy.',
    'If I were big.',
    'I wish he were here.',
    'Who is coming?',
    'What is that?',
    "There's two dogs.",
    'Do it now.',
    'Have a cookie.',
    'Do you like it?',
    'Does it work?',
  ])('%s', (sentence) => {
    expect(check(sentence)).toBe(sentence);
  });
});

describe('BE agreement: errors are coded', () => {
  it.each([
    ['He are running.', 'He are[EW:is] running.'],
    ['I are happy.', 'I are[EW:am] happy.'],
    ['They is happy.', 'They is[EW:are] happy.'],
    ['You is silly.', 'You is[EW:are] silly.'],
    ['That are mine.', 'That are[EW:is] mine.'],
    ['The dog are barking.', 'The dog are[EW:is] barking.'],
    ['The dogs is barking.', 'The dogs is[EW:are] barking.'],
    ['My friends is coming.', 'My friends is[EW:are] coming.'],
    ['The children is playing.', 'The children is[EW:are] playing.'],
    ['My pants is wet.', 'My pants is[EW:are] wet.'],
    ['The cookies was good.', 'The cookies was[EW:were] good.'],
    ['The cookie were good.', 'The cookie were[EW:was] good.'],
    ['We was playing.', 'We was[EW:were] playing.'],
    ['My mom and dad is here.', 'My mom and dad is[EW:are] here.'],
    ['The man who are nice.', 'The man who are[EW:is] nice.'],
    ['There is two dogs.', 'There is[EW:are] two dogs.'],
    ['There are a dog.', 'There are[EW:is] a dog.'],
    ['Are he coming?', 'Are[EW:Is] he coming?'],
    ['Is they coming?', 'Is[EW:Are] they coming?'],
    ['Where is they?', 'Where is[EW:are] they?'],
    ['Where is the dogs?', 'Where is[EW:are] the dogs?'],
    ['Does they like it?', 'Does[EW:Do] they like it?'],
    ['Do he like it?', 'Do[EW:Does] he like it?'],
  ])('%s', (input, expected) => {
    expect(check(input)).toBe(expected);
  });
});

describe('other agreement rules use the real subject', () => {
  it('does not add /*3s after compound or plural relative subjects', () => {
    expect(check('He and she walk.')).toBe('He and she walk.');
    expect(check('The dogs that walk.')).toBe('The dogs that walk.');
    expect(check('The dog that walk.')).toBe('The dog that walk/*3s.');
  });

  it('inserts an omitted auxiliary only for a clause-initial pronoun subject', () => {
    expect(check('He running.')).toBe('He *is running.');
    expect(check('They running fast.')).toBe('They *are running fast.');
    expect(check('I saw him running.')).toBe('I saw him running.');
    expect(check('What are you doing?')).toBe('What are you doing?');
  });
});
