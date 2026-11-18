import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import GuidesPage from './Guides.jsx';
import GuideArticlePage from './GuideArticle.jsx';
import { GUIDES, GUIDE_GLOSSARY } from '../lib/guides.js';

/* The guides are the site's citable layer: they must render as articles, keep a
 * single H1, expose the FAQ, and resolve from the router by slug. */

const withRouter = (path, element) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/guides" element={<GuidesPage />} />
        <Route path="/guides/:slug" element={element} />
      </Routes>
    </MemoryRouter>
  );

describe('research guides', () => {
  it('hub lists every guide and the glossary', () => {
    withRouter('/guides', <GuidesPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const guide of GUIDES) {
      expect(screen.getByText(guide.title)).toBeInTheDocument();
    }
    expect(screen.getByText(GUIDE_GLOSSARY[0][0])).toBeInTheDocument();
  });

  it('renders an article by slug with its sections and FAQ', () => {
    withRouter('/guides/next-bar-fill', <GuideArticlePage />);
    const guide = GUIDES.find((g) => g.slug === 'next-bar-fill');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: guide.title })).toBeInTheDocument();
    expect(screen.getByText(guide.sections[0].heading)).toBeInTheDocument();
    expect(screen.getByText(guide.faq[0][0])).toBeInTheDocument();
  });

  it('says so instead of rendering blank for an unknown slug', () => {
    withRouter('/guides/nope', <GuideArticlePage />);
    expect(screen.getByText(/Guide not found/i)).toBeInTheDocument();
  });

  it('every guide slug is unique and referenced by the public route manifest', async () => {
    const { PUBLIC_ROUTES } = await import('../lib/routes.js');
    const slugs = new Set(GUIDES.map((g) => g.slug));
    expect(slugs.size).toBe(GUIDES.length);
    const publicPaths = new Set(PUBLIC_ROUTES.map((r) => r.path));
    expect(publicPaths.has('/guides')).toBe(true);
    for (const guide of GUIDES) {
      expect(publicPaths.has(`/guides/${guide.slug}`), `/guides/${guide.slug} missing from PUBLIC_ROUTES`).toBe(true);
    }
  });
});
