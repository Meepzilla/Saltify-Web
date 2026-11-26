import { MoreHorizontal } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface OverflowMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Secondary text shown at the right (e.g. a version or current value). */
  hint?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Renders a check mark; for on/off options such as "Review all lines". */
  checked?: boolean;
  /** Draws a divider above this item. */
  dividerBefore?: boolean;
  /** Custom content instead of a button (e.g. a slider). */
  render?: () => ReactNode;
}

interface OverflowMenuProps {
  items: OverflowMenuItem[];
  label: string;
  /** Custom trigger content; defaults to a ⋯ icon. */
  trigger?: ReactNode;
  triggerClassName?: string;
  id?: string;
  disabled?: boolean;
}

/**
 * Compact "⋯" menu for secondary actions. Positioned with `position: fixed` so it is never
 * clipped by scrolling panes, and closes on outside tap, Escape, or selection.
 */
export function OverflowMenu({
  items,
  label,
  trigger,
  triggerClassName = 'btn btn-ghost btn-icon',
  id,
  disabled = false,
}: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const place = () => {
      const r = buttonRef.current!.getBoundingClientRect();
      const top = r.bottom + 6;
      setPos({
        top,
        right: Math.max(8, window.innerWidth - r.right),
        maxHeight: Math.max(160, window.innerHeight - top - 12),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    // Focus first enabled item for keyboard users
    requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []),
    ];
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={triggerClassName}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger ?? <MoreHorizontal size={18} />}
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="overflow-menu"
          style={{ top: pos.top, right: pos.right, maxHeight: pos.maxHeight }}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <div key={item.key}>
              {item.dividerBefore && <div className="overflow-menu-divider" role="separator" />}
              {item.render ? (
                <div className="overflow-menu-custom">{item.render()}</div>
              ) : (
                <button
                  type="button"
                  role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={item.checked}
                  className={`overflow-menu-item ${item.danger ? 'danger' : ''}`}
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.onSelect?.();
                  }}
                >
                  <span className="overflow-menu-icon" aria-hidden="true">
                    {item.checked !== undefined ? (item.checked ? '✓' : '') : item.icon}
                  </span>
                  <span className="overflow-menu-label">{item.label}</span>
                  {item.hint && <span className="overflow-menu-hint">{item.hint}</span>}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
