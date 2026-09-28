// 字体层：多字体回退检测 + 度量微调（等价 Perl 版 Font::FreeType 的用法）
// 使用 fontkit 解析；对象按需惰性创建，缓冲区由 AssetSource 提供

import fontkitRaw from '@pdf-lib/fontkit';

// @pdf-lib/fontkit 默认导出为工厂函数（Node 端可直接调用，Workers 端同样适用）
const fontkit: typeof fontkitRaw = fontkitRaw;

export interface FontFile {
  name: string;
  bytes: Uint8Array;
  face: ReturnType<typeof fontkit.create>;
}

export class FontSet {
  private files = new Map<string, FontFile>();

  async load(name: string, bytes: Uint8Array): Promise<FontFile> {
    const existing = this.files.get(name);
    if (existing) return existing;
    const face = fontkit.create(bytes);
    const file: FontFile = { name, bytes, face };
    this.files.set(name, file);
    return file;
  }

  get(name: string): FontFile | undefined {
    return this.files.get(name);
  }

  loaded(): string[] {
    return [...this.files.keys()];
  }

  /** 字符是否存在于该字体（glyph id 非 0），等价 font_check */
  hasGlyph(name: string, char: string): boolean {
    const f = this.files.get(name);
    if (!f) return false;
    const cp = char.codePointAt(0);
    if (cp === undefined) return false;
    return f.face.hasGlyphForCodePoint(cp);
  }

  /** 按字体数组顺序回退选择，等价 get_font；都不支持返回 null */
  pickFont(char: string, order: string[]): string | null {
    for (const f of order) {
      if (this.hasGlyph(f, char)) return f;
    }
    return null;
  }

  /**
   * 参考字符的字形高度（归一化到参考字号），等价 get_glyph_height。
   * fontkit 的 glyph bbox 为字体单位，除以 unitsPerEm 归一。
   */
  glyphHeight(name: string, char: string, refSize: number): number | null {
    const f = this.files.get(name);
    if (!f) return null;
    const cp = char.codePointAt(0);
    if (cp === undefined) return null;
    if (!f.face.hasGlyphForCodePoint(cp)) return null;
    const glyph = f.face.glyphForCodePoint(cp);
    const bbox = glyph.bbox;
    const h = bbox.maxY - bbox.minY;
    if (!(h > 0)) return null;
    const upem = f.face.unitsPerEm || 1000;
    return (h / upem) * refSize;
  }

  /** face 级高度（ascender - descender，归一化），等价 get_face_height */
  faceHeight(name: string, refSize: number): number | null {
    const f = this.files.get(name);
    if (!f) return null;
    const upem = f.face.unitsPerEm || 1000;
    const asc = (f.face.ascent / upem) * refSize;
    const desc = (f.face.descent / upem) * refSize;
    const h = asc - desc;
    return h > 0 ? h : null;
  }

  /**
   * 预计算各字体相对主字体的缩放因子，等价 compute_font_scales。
   * Phase1 参考字符字形高度 → Phase2 缺参考字符的字体用 face 高度+校准估算。
   */
  computeScales(
    allFonts: string[],
    primaryFont: string,
    refChar: string,
    refSize: number,
  ): Record<string, number> {
    const scale: Record<string, number> = {};
    if (!primaryFont) return scale;
    scale[primaryFont] = 1.0;

    const heights: Record<string, number> = {};
    const needsFallback: string[] = [];
    const primaryHeight = this.glyphHeight(primaryFont, refChar, refSize);
    if (!primaryHeight || primaryHeight <= 0) return scale;
    heights[primaryFont] = primaryHeight;

    for (const font of allFonts) {
      if (!font || font === primaryFont) continue;
      const h = this.glyphHeight(font, refChar, refSize);
      if (h && h > 0) heights[font] = h;
      else needsFallback.push(font);
    }

    if (needsFallback.length > 0) {
      const primaryFaceH = this.faceHeight(primaryFont, refSize);
      if (primaryFaceH && primaryFaceH > 0) {
        const calibration = primaryHeight / primaryFaceH;
        for (const font of needsFallback) {
          if (!font) continue;
          const faceH = this.faceHeight(font, refSize);
          if (faceH && faceH > 0) heights[font] = faceH * calibration;
        }
      }
    }

    for (const font of allFonts) {
      if (!font || font === primaryFont) continue;
      if (heights[font] && heights[font] > 0) scale[font] = primaryHeight / heights[font];
    }
    return scale;
  }
}
