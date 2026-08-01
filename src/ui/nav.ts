/**
 * Exhibit navigator — orientation for the full lab.
 *
 * The page is long on purpose: ten exhibits, each of which is the whole story
 * for somebody. This is the map. It sticks below the shared top bar, tracks
 * which exhibit you are reading, and carries the presenter controls (reset,
 * back to the guided demo) so they are reachable from anywhere rather than
 * buried in whichever panel happens to own them.
 *
 * Every exhibit keeps its plain `#id` anchor, so any section can be linked
 * from a class, an article or a slide.
 */

import { el, add, clear, button } from './dom'
import { state } from './state'

export interface NavSection {
  id: string
  label: string
}

export const SECTIONS: readonly NavSection[] = [
  { id: 'tour', label: 'Guided demo' },
  { id: 'intro', label: 'Idea' },
  { id: 'revocation', label: 'Revocation' },
  { id: 'mechanism', label: 'Mechanism' },
  { id: 'membership', label: 'Membership' },
  { id: 'nonmembership', label: 'Non-membership' },
  { id: 'dynamics', label: 'Updates' },
  { id: 'compare', label: 'Comparison' },
  { id: 'forge', label: 'Attacks' },
  { id: 'setup', label: 'Setup' },
  { id: 'scope', label: 'Scope' },
]

export function mountNav(host: HTMLElement): void {
  const nav = el('nav', { class: 'labnav', 'aria-label': 'Exhibits' })
  const list = el('ul', { class: 'labnav-list' })
  const links = new Map<string, HTMLAnchorElement>()

  for (const section of SECTIONS) {
    const a = el('a', { class: 'labnav-link', href: `#${section.id}`, text: section.label })
    links.set(section.id, a)
    list.appendChild(el('li', {}, a))
  }

  // Narrow viewports get a menu instead of a horizontally scrolling strip.
  const select = el('select', { class: 'labnav-select', 'aria-label': 'Jump to an exhibit' })
  for (const section of SECTIONS) {
    select.appendChild(el('option', { value: section.id, text: section.label }))
  }
  select.addEventListener('change', () => {
    document.getElementById(select.value)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  const resetBtn = button(
    'Reset demo',
    () => {
      state.reset()
      document.getElementById('tour')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Send the guided path back to its opening beat as well.
      window.dispatchEvent(new CustomEvent('accumulator:reset-tour'))
    },
    'btn-quiet btn-small',
  )
  resetBtn.title = 'Restore the deterministic starting set, parameters and digest'

  const status = el('p', {
    class: 'labnav-status',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Lab state',
  })

  add(
    nav,
    el('div', { class: 'labnav-scroll' }, list),
    select,
    el('div', { class: 'labnav-actions' }, status, resetBtn),
  )
  host.appendChild(nav)

  function renderStatus(): void {
    clear(status)
    add(
      status,
      el('span', { text: `${state.labels.length} revoked` }),
      el('span', { class: 'labnav-sep', 'aria-hidden': 'true', text: '·' }),
      el('span', { text: `digest #${state.version}` }),
    )
  }
  state.subscribe(renderStatus)
  renderStatus()

  // Scroll spy. Purely an affordance — the anchors work without it.
  if ('IntersectionObserver' in window) {
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        const current = SECTIONS.find((s) => visible.has(s.id))
        for (const [id, a] of links) {
          const isCurrent = current?.id === id
          a.classList.toggle('is-current', isCurrent)
          if (isCurrent) a.setAttribute('aria-current', 'true')
          else a.removeAttribute('aria-current')
        }
        if (current) select.value = current.id
      },
      { rootMargin: '-120px 0px -55% 0px' },
    )
    for (const section of SECTIONS) {
      const node = document.getElementById(section.id)
      if (node) observer.observe(node)
    }
  }
}
