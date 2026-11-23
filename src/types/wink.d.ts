declare module 'wink-pos-tagger' {
  export interface WinkToken {
    value: string;
    tag: string;
    normal: string;
    pos: string;
    lemma?: string;
  }

  export interface WinkPosTagger {
    tagSentence(sentence: string): WinkToken[];
    tagRawTokens(tokens: string[]): WinkToken[];
    defineConfig(config: Record<string, boolean>): void;
  }

  function posTagger(): WinkPosTagger;
  export default posTagger;
}

declare module 'wink-lemmatizer' {
  export interface WinkLemmatizer {
    noun(word: string): string;
    verb(word: string): string;
    adjective(word: string): string;
  }

  const lemmatizer: WinkLemmatizer;
  export default lemmatizer;
}
