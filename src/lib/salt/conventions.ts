import {
  conjugateThirdPersonSingular,
  isToBeVerb,
  lemmatizeNoun,
  lemmatizeVerb,
  posTagTokens,
  splitSentences,
  tokenizeForSalt,
} from './morphology';

export { isToBeVerb };

/**
 * Port of upstream `components/salt_utils.py: format_correction_for_convention_box`.
 * Normalizes a corrected line while preserving SALT annotations (`/*3s`, `[EW:...]`, etc.).
 */
export function formatCorrectionForConventionBox(correctedSentence: string): string {
  const sentence = correctedSentence.trim();
  if (!sentence) return '';

  const timestampMatch = sentence.match(/^(\[\d+:\d+\])\s*(.*)$/);
  if (timestampMatch) {
    const [, timestamp, body] = timestampMatch;
    return `${timestamp} ${body.trim()}\n`;
  }
  return `${sentence}\n`;
}

/**
 * Port of upstream `addConventions.py: removeErrorCoding`.
 * Strips SALT error codes and mazes so the underlying grammatical sentence can be POS-tagged.
 */
export function removeErrorCoding(input: string): string {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const cleanWords: string[] = [];
  let inMaze = false;

  for (const word of words) {
    if (inMaze) {
      if (word.includes(')')) {
        inMaze = false;
      }
      continue;
    }

    if (word.includes('(')) {
      // Single-word maze like "(the)" closes immediately; multi-word maze opens until ")"
      if (!word.includes(')')) {
        inMaze = true;
      }
      continue;
    }

    if (word.includes('[')) {
      if (word.includes(':')) {
        const colonIdx = word.indexOf(':');
        const closeIdx = word.indexOf(']', colonIdx);
        if (closeIdx > colonIdx) {
          const replacement = word.slice(colonIdx + 1, closeIdx);
          const trailingPunct = word.slice(closeIdx + 1);
          cleanWords.push(replacement + trailingPunct);
        }
      } else {
        // Extra word like "at[EW]" or utterance error like "[EU]" — omit from grammatical form
        const closeIdx = word.indexOf(']');
        const trailingPunct = closeIdx >= 0 ? word.slice(closeIdx + 1) : '';
        if (trailingPunct && cleanWords.length > 0) {
          cleanWords[cleanWords.length - 1] += trailingPunct;
        }
      }
      continue;
    }

    if (word.includes('/*3s')) {
      const match = word.match(/^([A-Za-z'-]+)\/\*3s(.*)$/);
      if (match) {
        cleanWords.push(conjugateThirdPersonSingular(match[1]) + match[2]);
      } else {
        cleanWords.push(conjugateThirdPersonSingular(word.replace('/*3s', '')));
      }
      continue;
    }

    if (word.includes('*')) {
      cleanWords.push(word.replace(/\*/g, ''));
      continue;
    }

    cleanWords.push(word);
  }

  return cleanWords.join(' ');
}

/**
 * Port of upstream `addConventions.py: addInflectionalMorphemesToSentence`.
 * Applies SALT inflectional morpheme slashes (/s, /z, /ed, /3s, /ing, contractions).
 */
export function addInflectionalMorphemesToSentence(
  sentence: string,
  speakerAliases: string[] = ['C', 'E']
): string {
  const speakerSet = new Set(['C', 'E', ...speakerAliases]);
  const tokens = posTagTokens(tokenizeForSalt(sentence));
  let converted = '';
  let mostRecentVerbIsToBe = false;
  let inDoubleQuote = false;

  for (let i = 0; i < tokens.length; i++) {
    const { word, tag } = tokens[i];
    const lower = word.toLowerCase();

    // Already SALT-coded word (e.g. walk/ed, dog/s, I/'m, can/'t, did/n't): leave untouched
    if (word.includes('/')) {
      converted += `${word} `;
      const root = lower.split('/')[0];
      if (/\/(?:'m|'s|'re)$/i.test(lower) || isToBeVerb(root)) {
        mostRecentVerbIsToBe = true;
      } else if (/\/(?:ed|3s|ing)$/i.test(lower)) {
        mostRecentVerbIsToBe = false;
      }
      continue;
    }

    // Speaker label prefix (e.g., C or E at utterance start)
    if (i === 0 && speakerSet.has(word)) {
      converted += `${word} `;
      continue;
    }

    if (word === '“' || word === '‘' || (word === '"' && !inDoubleQuote)) {
      converted += word;
      if (word === '"') inDoubleQuote = true;
      continue;
    }

    if (word === '”' || word === '’' || (word === '"' && inDoubleQuote)) {
      converted = `${converted.trimEnd()}${word} `;
      if (word === '"') inDoubleQuote = false;
      continue;
    }

    if (tag === 'NNS' && lower.endsWith('s')) {
      const lemma = lemmatizeNoun(word);
      converted += lemma.toLowerCase() === lower ? `${word} ` : `${lemma}/s `;
    } else if (word === "'s" && tag === 'POS') {
      converted = `${converted.trimEnd()}/z `;
    } else if (word === "'s") {
      converted = `${converted.trimEnd()}/'s `;
    } else if (tag === 'VBD' && lower.endsWith('ed')) {
      const lemma = lemmatizeVerb(word);
      converted += lemma.toLowerCase() === lower ? `${word} ` : `${lemma}/ed `;
    } else if (tag === 'VBZ' && lower !== 'is' && lower !== 'has' && lower.endsWith('s')) {
      const lemma = lemmatizeVerb(word);
      converted += lemma.toLowerCase() === lower ? `${word} ` : `${lemma}/3s `;
    } else if (tag === 'VBG' && mostRecentVerbIsToBe) {
      const lemma = lemmatizeVerb(word);
      if (lemma.toLowerCase() === lower) {
        converted += `${lemma} `;
      } else {
        converted += `${lemma}/ing `;
      }
    } else if (word === "n't") {
      converted = `${converted.trimEnd()}/n't `;
    } else if (word === "'t") {
      converted = `${converted.trimEnd()}/'t `;
    } else if (word === "'ll") {
      converted = `${converted.trimEnd()}/'ll `;
    } else if (word === "'m") {
      converted = `${converted.trimEnd()}/'m `;
    } else if (word === "'d") {
      converted = `${converted.trimEnd()}/'d `;
    } else if (word === "'re") {
      converted = `${converted.trimEnd()}/'re `;
    } else if (word === "'ve") {
      converted = `${converted.trimEnd()}/'ve `;
    } else if (word === ',' || word === '.' || word === '?' || word === '!' || word === ';') {
      converted = `${converted.trimEnd()}${word} `;
    } else {
      converted += `${word} `;
    }

    // Track whether the most recent verb was a "to be" verb so participles receive /ing
    // while non-progressive gerunds do not (matches upstream SpeechTranscription rule).
    if (
      tag === 'VB' ||
      tag === 'VBD' ||
      tag === 'VBP' ||
      tag === 'VBZ' ||
      lower === 'been'
    ) {
      mostRecentVerbIsToBe = isToBeVerb(lower);
    }
  }

  // Upstream manual irregular contraction rules
  converted = converted.replace(/\bca\/n't\b/g, "can/'t");
  converted = converted.replace(/\bCa\/n't\b/g, "Can/'t");
  converted = converted.replace(/\bdo\/n't\b/g, "don't");
  converted = converted.replace(/\bDo\/n't\b/g, "Don't");
  converted = converted.replace(/\bwo\/n't\b/g, "won't");
  converted = converted.replace(/\bWo\/n't\b/g, "Won't");

  return converted.trim();
}

/**
 * Port of upstream `addConventions.py: addInflectionalMorphemes`.
 * Preserves SALT error coding (`[EW:...]`, `[EP:...]`, `[EO:...]`, `[EW]`, `/*3s`, `*`, `(mazes)`)
 * while applying bound inflectional morpheme slashes to all other words.
 */
export function addInflectionalMorphemes(
  text: string,
  speakerAliases: string[] = ['C', 'E']
): string {
  const sentences = splitSentences(text);
  const outputLines: string[] = [];

  for (const sentence of sentences) {
    if (sentence.includes('[') || sentence.includes('*') || sentence.includes('(')) {
      const cleanSentence = removeErrorCoding(sentence);
      const morphemedClean = addInflectionalMorphemesToSentence(cleanSentence, speakerAliases);

      const originalWords = sentence.split(/\s+/).filter(Boolean);
      const correctedWords = morphemedClean.split(/\s+/).filter(Boolean);

      const finalWords: string[] = [];
      let origIdx = 0;
      let corrIdx = 0;

      while (origIdx < originalWords.length) {
        const origWord = originalWords[origIdx];

        if (origWord.includes('[EW]') || origWord === '[EU]') {
          // Extra word or utterance error was omitted from cleanSentence: do not advance corrIdx
          finalWords.push(origWord);
          origIdx += 1;
        } else if (origWord.includes('[') || origWord.includes('*')) {
          // Bracketed substitution/pronoun/overgeneralization error or missing-word/omitted-3s marker
          finalWords.push(origWord);
          origIdx += 1;
          corrIdx += 1;
        } else if (origWord.includes('(')) {
          // Maze start: preserve every token until matching ')'
          finalWords.push(origWord);
          let closed = origWord.includes(')');
          origIdx += 1;
          while (!closed && origIdx < originalWords.length) {
            finalWords.push(originalWords[origIdx]);
            if (originalWords[origIdx].includes(')')) {
              closed = true;
            }
            origIdx += 1;
          }
        } else {
          if (corrIdx < correctedWords.length) {
            finalWords.push(correctedWords[corrIdx]);
          } else {
            finalWords.push(origWord);
          }
          origIdx += 1;
          corrIdx += 1;
        }
      }

      outputLines.push(finalWords.join(' '));
    } else {
      outputLines.push(addInflectionalMorphemesToSentence(sentence, speakerAliases));
    }
  }

  return outputLines.join('\n');
}

/**
 * Apply SALT inflectional morphemes line-by-line while preserving `[m:ss]` timestamps and speaker labels.
 */
export function addInflectionalMorphemesToTranscript(
  transcript: string,
  speakerAliases: string[] = ['C', 'E']
): string {
  const lines = transcript.replace(/\r\n/g, '\n').split('\n');
  const speakerPattern = new RegExp(
    `^(${[...new Set(['C', 'E', ...speakerAliases])]
      .filter(Boolean)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})\\s+(.*)$`
  );

  const output = lines.map((rawLine) => {
    const line = rawLine.trim();
    if (!line) return '';

    let timestamp = '';
    let body = line;
    const tsMatch = body.match(/^(\[\d+:\d+\])\s*(.*)$/);
    if (tsMatch) {
      timestamp = tsMatch[1];
      body = tsMatch[2];
    }

    let speaker = '';
    const spMatch = body.match(speakerPattern);
    if (spMatch) {
      speaker = spMatch[1];
      body = spMatch[2];
    }

    const codedBody = addInflectionalMorphemes(body, speakerAliases).replace(/\n/g, ' ');
    return [timestamp, speaker, codedBody].filter(Boolean).join(' ');
  });

  return output.filter(Boolean).join('\n');
}
