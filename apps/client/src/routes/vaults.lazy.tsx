import { createLazyFileRoute } from '@tanstack/react-router'
import { VaultsPage } from '../pages/VaultsPage'

export const Route = createLazyFileRoute('/vaults')({
  component: VaultsPage,
})
