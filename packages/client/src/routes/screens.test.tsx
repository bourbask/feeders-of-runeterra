import { anId } from '@for/testkit';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CampaignList } from './CampaignList.js';
import { CharacterPicker } from './CharacterPicker.js';
import { Login } from './Login.js';

const campagne = {
  id: anId('campaign'),
  slug: 'le-col',
  name: 'Le col de Rakelstake',
  pitch: 'Une passe que personne ne franchit deux fois.',
  status: 'active' as const,
  ownerPlayerId: anId('player'),
  contentPackVersion: '1.0.0',
  seq: 12,
};

describe('l’écran de connexion', () => {
  it('propose un LIEN vers Discord, pas un bouton qui appellerait fetch', () => {
    render(<Login apiBaseUrl="https://api.test" />);
    const lien = screen.getByRole('link', { name: /Discord/u });
    expect(lien.getAttribute('href')).toBe('https://api.test/api/auth/discord/start');
  });
});

describe('la liste des tables', () => {
  it('dit qu’il n’y en a aucune plutôt que de ne rien afficher', () => {
    render(<CampaignList campagnes={[]} />);
    expect(screen.getByText(/Aucune table/u)).toBeDefined();
  });

  it('renvoie vers la table par son identifiant', () => {
    render(<CampaignList campagnes={[campagne]} />);
    const lien = screen.getByRole('link', { name: 'Le col de Rakelstake' });
    expect(lien.getAttribute('href')).toBe(`#/campagnes/${campagne.id}`);
  });
});

describe('le choix du champion', () => {
  const personnage = {
    id: anId('character'),
    campaignId: campagne.id,
    championId: 'braum',
    displayName: 'Braum',
    sheetSource: 'handwritten' as const,
    status: 'active' as const,
  };

  it('ne montre que les personnages de CETTE table', () => {
    render(
      <CharacterPicker
        campaignId={campagne.id}
        personnages={[personnage, { ...personnage, campaignId: anId('campaign', 2) }]}
      />,
    );
    expect(screen.getAllByText(/Braum/u)).toHaveLength(1);
  });

  it('annonce la tâche qui remplira l’écran quand il est vide', () => {
    render(<CharacterPicker campaignId={campagne.id} personnages={[]} />);
    expect(screen.getByText(/M0-24/u)).toBeDefined();
  });
});
