import { Directive, ElementRef, effect, inject, input, OnDestroy } from '@angular/core';

/**
 * Count-up animation for a formatted KPI string.
 *
 * Give it the final display text ("1.22 Cr", "59,312", "88.7%", "+17.1%",
 * "21.3 : 1") and it tweens the numeric part from the previously shown value
 * (0 on first paint) to the new one, keeping prefix, suffix, decimal places
 * and Indian digit grouping intact. Strings with no number ("–") are shown
 * as-is. Honours prefers-reduced-motion.
 */
@Directive({ selector: '[glCountUp]', standalone: true })
export class CountUpDirective implements OnDestroy {
  /** The final, fully formatted text. */
  readonly glCountUp = input.required<string>();
  /** Duration in ms. */
  readonly duration = input(600);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private frame = 0;
  private shown = 0;      // numeric value currently on screen
  private first = true;

  constructor() {
    effect(() => {
      const text = this.glCountUp();
      cancelAnimationFrame(this.frame);
      const m = /^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/s.exec(text ?? '');
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!m || reduce) { this.el.nativeElement.textContent = text ?? ''; this.first = false; return; }
      const [, prefix, numText, suffix] = m;
      const target = parseFloat(numText.replace(/,/g, ''));
      const dp = (numText.split('.')[1] ?? '').length;
      const from = this.first ? 0 : this.shown;
      this.first = false;
      const fmt = (v: number) => prefix + v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }) + suffix;
      const t0 = performance.now(), dur = this.duration();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
        const v = from + (target - from) * e;
        this.el.nativeElement.textContent = fmt(p < 1 ? v : target);
        if (p < 1) this.frame = requestAnimationFrame(tick); else this.shown = target;
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  ngOnDestroy(): void { cancelAnimationFrame(this.frame); }
}
