import { createFileRoute } from '@tanstack/react-router';
import { SearchPage } from '@/pages/SearchPage';

export const Route = createFileRoute('/search')({
  component: SearchPage,
});
