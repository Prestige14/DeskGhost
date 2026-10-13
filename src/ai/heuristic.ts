import path from 'node:path';
import { ExtractedContent } from '../extractors/types.js';
import { ClassificationResult } from '../config/types.js';
import { AIProvider } from './types.js';

function formatDatePrefix(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim();
}

export class HeuristicProvider implements AIProvider {
  name = 'heuristic';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async classify(content: ExtractedContent): Promise<ClassificationResult> {
    const rawName = content.fileName;
    const ext = content.fileExtension.toLowerCase();
    const parsed = path.parse(rawName);
    const baseNameLower = parsed.name.toLowerCase();
    const textSample = (content.textSnippet || '').toLowerCase();
    const combined = `${baseNameLower} ${textSample}`;
    const datePrefix = formatDatePrefix(content.createdDate);

    let category = 'Documents';
    let titleSlug = parsed.name;
    let reason = 'Rule-based categorization based on file properties and patterns.';
    let confidence = 0.75;

    // 1. Screenshots
    if (
      baseNameLower.includes('screenshot') ||
      baseNameLower.includes('screen shot') ||
      baseNameLower.includes('tangkapan layar') ||
      baseNameLower.startsWith('capture') ||
      baseNameLower.startsWith('ss_')
    ) {
      category = 'Screenshots';
      titleSlug = `Screenshot_${parsed.name.replace(/[^a-zA-Z0-9]/g, '_').slice(-8) || 'Captured'}`;
      reason = 'Detected screenshot naming convention';
      confidence = 0.9;
    }
    // 2. Travel & Flights
    else if (
      combined.includes('flight') ||
      combined.includes('tiket') ||
      combined.includes('ticket') ||
      combined.includes('boarding pass') ||
      combined.includes('garuda') ||
      combined.includes('airasia') ||
      combined.includes('hotel') ||
      combined.includes('booking') ||
      combined.includes('itinerary')
    ) {
      category = 'Travel';
      let entity = 'Ticket';
      if (combined.includes('garuda')) entity = 'Garuda_Flight';
      else if (combined.includes('hotel')) entity = 'Hotel_Booking';
      else if (combined.includes('boarding')) entity = 'Boarding_Pass';
      titleSlug = `${entity}`;
      reason = 'Contains travel, flight, or booking references';
      confidence = 0.85;
    }
    // 3. Finances & Invoices
    else if (
      combined.includes('invoice') ||
      combined.includes('receipt') ||
      combined.includes('bill') ||
      combined.includes('struk') ||
      combined.includes('faktur') ||
      combined.includes('kwitansi') ||
      combined.includes('payment') ||
      combined.includes('pembayaran')
    ) {
      category = 'Finances';
      let entity = 'Invoice';
      if (combined.includes('receipt') || combined.includes('struk')) entity = 'Receipt';
      else if (combined.includes('faktur')) entity = 'Faktur_Pajak';
      titleSlug = `${entity}`;
      reason = 'Identified financial invoice or payment receipt keyword';
      confidence = 0.88;
    }
    // 4. Resume & HR
    else if (
      combined.includes('resume') ||
      combined.includes('curriculum vitae') ||
      combined.includes('cv') ||
      combined.includes('portfolio')
    ) {
      category = 'Personal';
      titleSlug = 'Resume_CV';
      reason = 'Recognized curriculum vitae or resume document';
      confidence = 0.9;
    }
    // 5. Contracts & Legal
    else if (
      combined.includes('contract') ||
      combined.includes('agreement') ||
      combined.includes('perjanjian') ||
      combined.includes('kontrak') ||
      combined.includes('nda')
    ) {
      category = 'Documents';
      titleSlug = 'Contract_Agreement';
      reason = 'Recognized legal contract or agreement keyword';
      confidence = 0.85;
    }
    // 6. Data & Spreadsheets
    else if (['.csv', '.tsv', '.xlsx', '.xls', '.parquet'].includes(ext)) {
      category = 'Data';
      titleSlug = parsed.name;
      reason = 'Tabular spreadsheet or dataset format';
      confidence = 0.8;
    }
    // 7. Code & Development
    else if (content.type === 'code' || ['.js', '.ts', '.py', '.rs', '.go', '.json', '.yaml', '.yml'].includes(ext)) {
      category = 'Development';
      titleSlug = parsed.name;
      reason = 'Recognized source code or configuration script';
      confidence = 0.85;
    }
    // 8. Archives
    else if (['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz'].includes(ext)) {
      category = 'Archives';
      titleSlug = parsed.name;
      reason = 'Compressed archive container';
      confidence = 0.9;
    }
    // 9. Installers
    else if (['.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm'].includes(ext)) {
      category = 'Installers';
      titleSlug = parsed.name;
      reason = 'Software installer or binary package';
      confidence = 0.9;
    }
    // 10. Media
    else if (['.mp4', '.mov', '.mkv', '.avi', '.mp3', '.wav', '.flac'].includes(ext)) {
      category = 'Media';
      titleSlug = parsed.name;
      reason = 'Audio or video media asset';
      confidence = 0.85;
    }
    // 11. Generic Images
    else if (content.type === 'image') {
      category = 'Images';
      titleSlug = parsed.name.replace(/screenshot/gi, 'Image');
      reason = 'Visual image file';
      confidence = 0.7;
    }

    // Build normalized suggested name
    const cleanedTitle = sanitizeFileName(titleSlug);
    let suggestedName = `${datePrefix}_${cleanedTitle}${ext}`;
    if (cleanedTitle.startsWith(datePrefix)) {
      suggestedName = `${cleanedTitle}${ext}`;
    }

    return {
      suggestedName,
      category,
      reason,
      confidence,
      providerUsed: 'heuristic'
    };
  }
}
