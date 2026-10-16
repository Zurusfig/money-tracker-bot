"use client";

// Interaction primitives. Specs in docs/DESIGN.md (sections B and C).
import {
  AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion, useSpring, useTransform,
  type AnimationPlaybackControls, type PanInfo,
} from "motion/react";
import { ChevronLeft, ChevronRight, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const SPRING_MOVE = { type: "spring", visualDuration: 0.4, bounce: 0 } as const; // damping 1.0, response 0.4
export const SPRING_SHEET = { type: "spring", visualDuration: 0.3, bounce: 0 } as const; // response 0.3
export const SPRING_PRESS = { type: "spring", visualDuration: 0.15, bounce: 0 } as const;
const DECEL = 0.998; // iOS "normal" deceleration rate
const project = (v: number) => ((v / 1000) * DECEL) / (1 - DECEL); // px travelled after release

// Feedback on pointer-down (whileTap fires on press, not on release)
export function Press({ className = "btn", children, ...rest }: React.ComponentProps<typeof motion.button>) {
  return (
    <motion.button className={className} whileTap={{ scale: 0.96 }} transition={SPRING_PRESS} {...rest}>
      {children}
    </motion.button>
  );
}

// Counts from the previous value to the new one (critically damped, no bounce)
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { visualDuration: 0.6, bounce: 0 });
  const text = useTransform(spring, (v) => format(v));
  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);
  return <motion.span className="num">{text}</motion.span>;
}

export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { v: T; label: string }[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <motion.button
          key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}
          whileTap={{ opacity: 0.6 }} transition={SPRING_PRESS}
        >
          {value === o.v && <motion.span layoutId="seg-pill" className="seg-pill" transition={{ type: "spring", visualDuration: 0.35, bounce: 0 }} />}
          <span className="seg-label">{o.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

// Period label you can swipe; the new label enters from the side the finger moved toward
export function PeriodSwiper({ label, dir, onPrev, onNext, canNext }: {
  label: string; dir: 1 | -1; onPrev: () => void; onNext: () => void; canNext: boolean;
}) {
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const p = info.offset.x + info.velocity.x * 0.2;
    if (p < -80 && canNext) onNext();
    else if (p > 80) onPrev();
  };
  return (
    <div className="nav">
      <Press className="btn icon" onClick={onPrev} aria-label="Previous period"><ChevronLeft size={18} aria-hidden /></Press>
      <motion.div
        className="swipe" drag="x" dragDirectionLock dragSnapToOrigin
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={canNext ? 0.2 : { left: 0.08, right: 0.2 }}
        dragTransition={{ bounceStiffness: 400, bounceDamping: 40 }}
        onDragEnd={onDragEnd}
        aria-label="Swipe to change period"
      >
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <motion.div
            key={label} custom={dir} className="label"
            variants={{ enter: (d: number) => ({ x: d * 48, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: -d * 48, opacity: 0 }) }}
            initial="enter" animate="center" exit="exit" transition={SPRING_MOVE}
          >
            {label}
          </motion.div>
        </AnimatePresence>
      </motion.div>
      <Press className="btn icon" onClick={onNext} disabled={!canNext} aria-label="Next period"><ChevronRight size={18} aria-hidden /></Press>
    </div>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("dash-theme", next); } catch {}
    setTheme(next);
  };
  return (
    <Press className="btn icon" onClick={flip} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
      {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </Press>
  );
}

// Bottom sheet: snaps full / half / closed from projected momentum, velocity handed to the spring,
// grabbable mid-flight, rubber-bands above full.
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const [vh, setVh] = useState(800);
  const [mounted, setMounted] = useState(false);
  const y = useMotionValue(800);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const controls = useDragControls();
  const start = useRef<{ x: number; y: number; id: number; dragging: boolean } | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const full = Math.round(vh * 0.08);
  const half = Math.round(vh * 0.45);
  const scrim = useTransform(y, [full, vh], [0.55, 0]);

  const reduce = useReducedMotion();
  const to = (target: number, velocity = 0, then?: () => void) => {
    anim.current?.stop();
    if (reduce) {
      // Reduced motion: no slide; the scrim still follows y, so it simply appears
      anim.current = null;
      y.jump(target);
      then?.();
      return;
    }
    const bounce = Math.abs(velocity) > 600 && target !== vh ? 0.2 : 0; // bounce only when thrown
    const a = animate(y, target, { ...SPRING_SHEET, bounce, velocity });
    anim.current = a;
    // only if this animation wasn't interrupted (re-opened or grabbed meanwhile)
    if (then) a.finished.then(() => { if (anim.current === a && Math.abs(y.get() - target) < 1) then(); });
  };

  useEffect(() => {
    if (open) {
      const h = window.innerHeight;
      setVh(h);
      if (!mounted) y.jump(h);
      setMounted(true);
      requestAnimationFrame(() => {
        to(Math.round(h * 0.45));
        closeBtn.current?.focus({ preventScroll: true });
      });
    } else if (mounted) {
      to(window.innerHeight, 0, () => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const v = info.velocity.y;
    const projected = y.get() + project(v);
    if (projected > vh * 0.7) {
      onClose();
      return;
    }
    const target = [full, half].reduce((a, b) => (Math.abs(b - projected) < Math.abs(a - projected) ? b : a));
    to(target, v);
  };

  if (!mounted) return null;
  return (
    <div className="sheet-root">
      <motion.div className="scrim" style={{ opacity: scrim }} onClick={onClose} aria-hidden />
      <motion.div
        className="sheet" role="dialog" aria-modal="true"
        style={{ y, height: vh - full }}
        drag="y" dragListener={false} dragControls={controls} dragMomentum={false}
        dragConstraints={{ top: full, bottom: vh }} dragElastic={{ top: 0.12, bottom: 0 }}
        onDragEnd={onDragEnd}
      >
        <div
          className="sheet-head"
          onPointerDown={(e) => {
            anim.current?.stop(); // grab it mid-flight
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false };
          }}
          onPointerMove={(e) => {
            const s = start.current;
            if (!s || s.dragging || s.id !== e.pointerId) return;
            if (Math.abs(e.clientY - s.y) > 10) { // ~10px hysteresis before the drag wins
              s.dragging = true;
              controls.start(e);
            }
          }}
          onPointerUp={() => { start.current = null; }}
        >
          <div className="grabber" aria-hidden />
          <div className="sheet-title">
            <div>{title}</div>
            <Press ref={closeBtn} className="btn icon" onClick={onClose} aria-label="Close"><X size={18} aria-hidden /></Press>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </motion.div>
    </div>
  );
}
