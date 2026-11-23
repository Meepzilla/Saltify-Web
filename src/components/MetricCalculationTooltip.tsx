import { Calculator, X } from 'lucide-react';
import type { MetricCalculationBreakdown } from '../engine/saltMetrics';

interface MetricCalculationTooltipProps {
  breakdown: MetricCalculationBreakdown;
  speakerLabel: string;
  accentVar?: string;
  onClose: () => void;
}

export function MetricCalculationTooltip({
  breakdown,
  speakerLabel,
  accentVar,
  onClose,
}: MetricCalculationTooltipProps) {
  return (
    <div
      id="metric-calculation-tooltip"
      className="calc-tooltip"
      role="status"
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="calc-tooltip-header">
        <div className="calc-tooltip-title-group">
          <Calculator size={14} className="calc-tooltip-icon" />
          <span
            className="calc-tooltip-speaker"
            style={accentVar ? { color: accentVar } : undefined}
          >
            {speakerLabel}
          </span>
          <strong className="calc-tooltip-title">{breakdown.title}</strong>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon calc-tooltip-close"
          onClick={onClose}
          aria-label="Close calculation tooltip"
        >
          <X size={14} />
        </button>
      </div>

      <div className="calc-tooltip-rows">
        <div className="calc-tooltip-row">
          <span className="calc-tooltip-k">Formula</span>
          <code className="calc-tooltip-formula">{breakdown.formula}</code>
        </div>
        <div className="calc-tooltip-row">
          <span className="calc-tooltip-k">Calculation</span>
          <span className="calc-tooltip-math">{breakdown.calculation}</span>
        </div>
      </div>

      <p className="calc-tooltip-note">{breakdown.note}</p>
    </div>
  );
}
