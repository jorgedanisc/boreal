import { createLazyFileRoute } from '@tanstack/react-router'
import { SetupWizard } from '../components/setup/SetupWizard'

export const Route = createLazyFileRoute('/setup')({
    component: SetupWizard,
})
