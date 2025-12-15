import { createLazyFileRoute } from '@tanstack/react-router'
import GalleryPage from '../pages/Gallery'

export const Route = createLazyFileRoute('/gallery')({
    component: GalleryPage,
})
