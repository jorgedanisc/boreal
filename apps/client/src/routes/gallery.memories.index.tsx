import { createFileRoute } from '@tanstack/react-router'
import MemoriesPage from '../pages/Memories'

export const Route = createFileRoute('/gallery/memories/')({
  component: MemoriesPage,
})
