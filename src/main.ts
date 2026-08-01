import './styles.css'
import { mountIntro } from './ui/intro'
import { mountMechanism } from './ui/mechanism'
import { mountMembership } from './ui/membership'
import { mountNonMembership } from './ui/nonmembership'
import { mountDynamics } from './ui/dynamics'
import { mountForge } from './ui/forge'
import { mountCompare } from './ui/compare'
import { mountRevocation } from './ui/revocation'
import { mountSetup } from './ui/setup'
import { mountScope } from './ui/scope'

const mount = document.getElementById('exhibits')
if (mount) {
  mountIntro(mount)
  mountMechanism(mount)
  mountMembership(mount)
  mountNonMembership(mount)
  mountDynamics(mount)
  mountRevocation(mount)
  mountForge(mount)
  mountCompare(mount)
  mountSetup(mount)
  mountScope(mount)
}
