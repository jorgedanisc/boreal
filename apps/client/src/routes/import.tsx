import { createFileRoute } from '@tanstack/react-router'
import { ImportStep } from '../components/setup/ImportStep'
import { useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/import')({
  component: ImportPage,
})

function ImportPage() {
  const navigate = useNavigate()

  const handleBack = () => {
    // If we have history, go back, otherwise go to setup
    if (window.history.length > 1) {
      navigate({ to: '..' })
    } else {
      navigate({ to: '/setup' })
    }
  }

  const handleComplete = () => {
    navigate({ to: '/gallery' })
  }

  return (
    <ImportStep
      onBack={handleBack}
      onComplete={handleComplete}
    />
  )
}
