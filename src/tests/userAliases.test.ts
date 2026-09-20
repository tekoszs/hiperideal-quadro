import { describe, it, expect } from 'vitest';
import { resolveUserAlias, isKnownAlias } from '@/lib/userAliases';

describe('userAliases', () => {
  describe('resolveUserAlias', () => {
    it('resolves jackson → jackson.costa@hiperideal.com.br', () => {
      expect(resolveUserAlias('jackson')).toBe('jackson.costa@hiperideal.com.br');
    });

    it('resolves Jackson (capitalized) → same email', () => {
      expect(resolveUserAlias('Jackson')).toBe('jackson.costa@hiperideal.com.br');
    });

    it('resolves JACKSON (uppercase) → same email', () => {
      expect(resolveUserAlias('JACKSON')).toBe('jackson.costa@hiperideal.com.br');
    });

    it('resolves " jackson " (with spaces) → same email', () => {
      expect(resolveUserAlias(' jackson ')).toBe('jackson.costa@hiperideal.com.br');
    });

    it('resolves paulo → paulo.sergio@hiperideal.com.br', () => {
      expect(resolveUserAlias('paulo')).toBe('paulo.sergio@hiperideal.com.br');
    });

    it('resolves ericson → ericson.silva@hiperideal.com.br', () => {
      expect(resolveUserAlias('ericson')).toBe('ericson.silva@hiperideal.com.br');
    });

    it('resolves anias → roberval.anias@hiperideal.com.br', () => {
      expect(resolveUserAlias('anias')).toBe('roberval.anias@hiperideal.com.br');
    });

    it('resolves ANIAS (uppercase) → same email', () => {
      expect(resolveUserAlias('ANIAS')).toBe('roberval.anias@hiperideal.com.br');
    });

    it('returns null for "roberval" (not a valid alias)', () => {
      expect(resolveUserAlias('roberval')).toBeNull();
    });

    it('returns null for unknown username', () => {
      expect(resolveUserAlias('desconhecido')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(resolveUserAlias('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(resolveUserAlias('   ')).toBeNull();
    });
  });

  describe('isKnownAlias', () => {
    it('returns true for known alias', () => {
      expect(isKnownAlias('jackson')).toBe(true);
    });

    it('returns true for case-insensitive alias', () => {
      expect(isKnownAlias('JACKSON')).toBe(true);
    });

    it('returns false for unknown alias', () => {
      expect(isKnownAlias('roberval')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isKnownAlias('')).toBe(false);
    });
  });
});
