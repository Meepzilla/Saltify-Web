import { useState } from 'react';
import { DEFAULT_FLAG_THRESHOLDS, type FlagThresholds } from '../engine/wordConfidence';

/** Inline "Replace with…" field inside a word's fix menu. Enter or the button applies it. */
export function ReplaceWordField({
  initial,
  onSubmit,
}: {
  initial: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    const value = text.trim();
    if (value) onSubmit(value);
  };
  return (
    <form
      className="replace-word-field"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="replace-word-label" htmlFor="replace-word-input">
        Replace with
      </label>
      <div className="replace-word-row">
        <input
          id="replace-word-input"
          type="text"
          className="replace-word-input"
          value={text}
          placeholder={initial ? `Instead of “${initial}”` : 'Type the correct word'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()}>
          Replace
        </button>
      </div>
    </form>
  );
}

function SensitivitySlider({
  id,
  label,
  help,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="sensitivity-row">
      <div className="sensitivity-head">
        <label htmlFor={id}>{label}</label>
        <span className="mono">{Math.round(value * 100)}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={5}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-valuetext={`${Math.round(value * 100)} percent`}
      />
      <div className="sensitivity-help">{help}</div>
    </div>
  );
}

/** Live review sensitivity: the transcript's highlights update while dragging. */
export function FlagSensitivityControls({
  value,
  flaggedCount,
  onChange,
}: {
  value: FlagThresholds;
  flaggedCount: number;
  onChange: (next: FlagThresholds) => void;
}) {
  const isDefault =
    value.uncertainBelow === DEFAULT_FLAG_THRESHOLDS.uncertainBelow &&
    value.disagreementBelow === DEFAULT_FLAG_THRESHOLDS.disagreementBelow;
  return (
    <div className="sensitivity-controls">
      <div className="sensitivity-title">
        <span>Review sensitivity</span>
        <span className="sensitivity-count">{flaggedCount} flagged</span>
      </div>
      <SensitivitySlider
        id="sensitivity-uncertain"
        label="Flag words Whisper was less sure than"
        help="Higher flags more words (catches more errors, more to check)."
        min={20}
        max={95}
        value={value.uncertainBelow}
        onChange={(v) => onChange({ ...value, uncertainBelow: v })}
      />
      <SensitivitySlider
        id="sensitivity-disagree"
        label="Flag model disagreements below"
        help="Needs Second Opinion. 100% flags every disagreement."
        min={50}
        max={100}
        value={value.disagreementBelow}
        onChange={(v) => onChange({ ...value, disagreementBelow: v })}
      />
      {!isDefault && (
        <button
          type="button"
          className="btn btn-ghost btn-sm sensitivity-reset"
          onClick={() => onChange({ ...DEFAULT_FLAG_THRESHOLDS })}
        >
          Reset to recommended (60% / 90%)
        </button>
      )}
    </div>
  );
}
