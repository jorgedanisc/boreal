import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TitleBar } from '../components/TitleBar'

export const Route = createRootRoute({
  component: () => (
    <div className="relative dvh dvw bg-background">
      <TitleBar />
      <Outlet />
    </div>
  ),
})
