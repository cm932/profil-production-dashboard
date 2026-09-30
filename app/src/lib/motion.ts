// Общие параметры анимации. Правила (VOLT + принципы Эмиля Ковальски):
//  · быстро: интерфейс до 320 мс, графики до 600 мс;
//  · сильное замедление в конце (ease-out), никакого ease-in;
//  · анимируем только transform и opacity, никогда не начинаем с scale(0);
//  · при prefers-reduced-motion движение отключается, остаётся мгновенная смена состояния.
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1]
export const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1]

export const prefersReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Появление блока: сдвиг на 8 px + прозрачность. Задержка между соседями 40 мс (правило 30–80 мс). */
// Полная строка transform, а не сокращение y: сокращения motion идут через главный поток и роняют кадры под нагрузкой
export const reveal = (i = 0) => ({
  initial: { opacity: 0, transform: 'translateY(8px)' },
  animate: { opacity: 1, transform: 'translateY(0px)' },
  transition: { duration: 0.28, ease: EASE_OUT, delay: Math.min(i, 8) * 0.04 },
})

/** Пружина без отскока (критическое затухание) — основная для интерфейса по принципам Apple:
 *  анимация начинается с текущего значения, её можно прервать и развернуть в любой момент. */
export const SPRING = { type: 'spring', bounce: 0, duration: 0.35 } as const
