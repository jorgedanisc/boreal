import { PairingPage } from '@/pages/PairingPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/pairing')({
  component: PairingPage,
})