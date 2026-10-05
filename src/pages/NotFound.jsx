import React from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Card, EmptyState } from '../components/ui.jsx';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <EmptyState
          icon={<Compass size={30} className="text-muted-foreground" />}
          title="Page not found"
          sub="The page you're looking for doesn't exist or was moved."
          action={<Link to="/" className="btn-primary">Back to Crypto Market</Link>}
        />
      </Card>
    </div>
  );
}
