import { createFileRoute } from '@tanstack/react-router'
import { VaultsPage } from '../pages/VaultsPage'

export const Route = createFileRoute('/vaults')({
  component: VaultsPage,
})
