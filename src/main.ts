import './styles.css'
import { mountTour } from './ui/tour'
import { mountNav } from './ui/nav'
import { mountIntro } from './ui/intro'
import { mountRevocation } from './ui/revocation'
import { mountMechanism } from './ui/mechanism'
import { mountMembership } from './ui/membership'
import { mountNonMembership } from './ui/nonmembership'
import { mountDynamics } from './ui/dynamics'
import { mountCompare } from './ui/compare'
import { mountForge } from './ui/forge'
import { mountSetup } from './ui/setup'
import { mountScope } from './ui/scope'

/**
 * Order follows the story, not the mathematics: the stakes first (guided demo,
 * then the revocation problem), then the mechanism that answers them, then the
 * trade-offs, then the attack that undoes it, then honest scoping.
 */
const exhibits = document.getElementById('exhibits')
const tourHost = document.getElementById('tourhost')
const navHost = document.getElementById('labnav')

if (exhibits) {
  mountIntro(exhibits)
  mountRevocation(exhibits)
  mountMechanism(exhibits)
  mountMembership(exhibits)
  mountNonMembership(exhibits)
  mountDynamics(exhibits)
  mountCompare(exhibits)
  mountForge(exhibits)
  mountSetup(exhibits)
  mountScope(exhibits)
}
if (tourHost) mountTour(tourHost)
// Mounted last: the scroll spy needs every exhibit to exist in the DOM.
if (navHost) mountNav(navHost)
