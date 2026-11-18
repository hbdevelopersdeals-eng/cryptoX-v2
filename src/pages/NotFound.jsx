import React from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState } from '../components/ui.jsx';
import { NotFoundIllustration } from '../components/EmptyIllustrations.jsx';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <EmptyState
          icon={<NotFoundIllustration size={120} className="mb-3" />}
          title="Lost in Blockchain Space"
          sub="The page you're looking for doesn't exist, was moved, or the block hash is invalid."
          action={<Link to="/" className="btn-primary">Back to Crypto Market</Link>}
        />
      </Card>
    </div>
  );
}
