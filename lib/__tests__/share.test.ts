import { normalizeWhatsAppPhone, sharePdfFile } from '../share';

describe('normalizeWhatsAppPhone', () => {
  test('converts local BD numbers with trunk zero to international format', () => {
    expect(normalizeWhatsAppPhone('01712345678')).toBe('8801712345678');
  });

  test('keeps numbers already in international format', () => {
    expect(normalizeWhatsAppPhone('8801712345678')).toBe('8801712345678');
  });

  test('strips + prefix and separators from international numbers', () => {
    expect(normalizeWhatsAppPhone('+880 1712-345678')).toBe('8801712345678');
  });

  test('handles 00 international prefix', () => {
    expect(normalizeWhatsAppPhone('008801712345678')).toBe('8801712345678');
  });

  test('prepends country code to a number with no trunk zero', () => {
    expect(normalizeWhatsAppPhone('1712345678')).toBe('8801712345678');
  });

  test('ignores non-digit characters in local numbers', () => {
    expect(normalizeWhatsAppPhone('+880 1712 345 678')).toBe('8801712345678');
  });

  test('returns empty string for missing or non-numeric input', () => {
    expect(normalizeWhatsAppPhone(null)).toBe('');
    expect(normalizeWhatsAppPhone(undefined)).toBe('');
    expect(normalizeWhatsAppPhone('')).toBe('');
    expect(normalizeWhatsAppPhone('not-a-phone')).toBe('');
  });

  test('respects a custom country code', () => {
    expect(normalizeWhatsAppPhone('09123456789', '91')).toBe('919123456789');
  });
});

describe('sharePdfFile', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  function stubNavigator(value: unknown) {
    Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  }

  afterEach(() => {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  });

  test('shares the PDF on its own, with no text or title attached', async () => {
    // WhatsApp renders any accompanying text as a separate chat message, so the
    // share payload must carry the file and nothing else.
    const share = jest.fn().mockResolvedValue(undefined);
    stubNavigator({ share, canShare: () => true });

    const file = new File(['%PDF-1.4'], 'INVOICE-0001.pdf', { type: 'application/pdf' });
    await expect(sharePdfFile(file)).resolves.toBe('shared');

    expect(share).toHaveBeenCalledTimes(1);
    const payload = share.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(['files']);
    expect(payload.text).toBeUndefined();
    expect(payload.title).toBeUndefined();
  });
});
