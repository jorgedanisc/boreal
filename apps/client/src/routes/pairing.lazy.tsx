import { PairingPage } from '@/pages/PairingPage'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/pairing')({
  component: PairingPage,
})