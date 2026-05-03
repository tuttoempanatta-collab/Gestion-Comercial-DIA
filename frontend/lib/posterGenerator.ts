import { jsPDF } from 'jspdf';

export interface PosterData {
  codigo: string;
  articulo: string;
  combo: string;
  precioOriginal: string;
  precioFinal: number;
  desde: string;
  hasta: string;
  cashbackPrice?: number;
  cashbackLabel?: string;
  cashbackCondition?: string;
  cashbackPercentage?: string;
  cashbackDay?: string;
  requiredUnits?: number;
}

export const generatePosters = (items: PosterData[], previewOnly: boolean = false): string | void => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  items.forEach((item, index) => {
    if (index > 0) {
      doc.addPage();
    }

    const PAGE_CENTER = 105;

    // --- TOP BOXES ---
    doc.setDrawColor(0);
    doc.setLineWidth(1.4);
    
    let mainCombo = item.combo || 'OFERTA';
    let requiredUnits = 0;
    let comboNumber = '';
    let subCombo = '';
    let comboSymbol = '';
    const text = mainCombo.toLowerCase();
    
    const nxmMatch = text.match(/(\d+)\s*x\s*(\d+)/i);
    const llevandoMatch = text.match(/llevando\s*(\d+)/i);
    
    // PRIORITIZE MANUAL OVERRIDE
    const manualUnits = typeof item.requiredUnits === 'string' ? parseInt(item.requiredUnits) : item.requiredUnits;
    
    if (manualUnits && manualUnits > 0) {
      requiredUnits = manualUnits;
      if (nxmMatch) {
         comboNumber = `${requiredUnits}X${nxmMatch[2]}`;
         subCombo = `LLEVANDO ${requiredUnits}`;
      } else {
         comboNumber = 'LLEVANDO';
         subCombo = `${requiredUnits} UNIDADES`;
      }
    } else if (nxmMatch) {
      requiredUnits = parseInt(nxmMatch[1]);
      comboNumber = `${nxmMatch[1]}X${nxmMatch[2]}`;
      subCombo = `LLEVANDO ${nxmMatch[1]}`;
    } else if (llevandoMatch) {
      requiredUnits = parseInt(llevandoMatch[1]);
      comboNumber = 'LLEVANDO';
      subCombo = `${llevandoMatch[1]} UNIDADES`;
    } else if (text.includes('2d') || text.includes('segunda')) {
      requiredUnits = 2;
    }

    // Default to 1 if it's a "llevando" style but no units were found
    if (requiredUnits === 0 && (text.includes('llevando') || comboNumber === 'LLEVANDO')) {
      requiredUnits = 1;
      if (comboNumber === 'LLEVANDO') subCombo = '1 UNIDAD';
    }

    if (!nxmMatch && !llevandoMatch) {
      if (text.includes('2d') && text.includes('%')) {
        const match = text.match(/(\d+)\s*(%)/);
        if (match) {
          comboNumber = match[1];
          comboSymbol = match[2];
          subCombo = '2da UNIDAD';
        }
      } else if (text.includes('%')) {
        const match = text.match(/(\d+)\s*(%)/);
        if (match) {
          comboNumber = match[1];
          comboSymbol = match[2];
          subCombo = 'DESCUENTO';
        }
      } else if (text.includes('x')) {
        const match = text.match(/(\d+x\d+)/);
        if (match) {
          comboNumber = match[1].toUpperCase();
          const n = match[1].split('x')[0];
          requiredUnits = parseInt(n);
          subCombo = `LLEVANDO ${n}`;
        }
      } else {
        comboNumber = mainCombo.toUpperCase();
      }
    }

    const smallBoxWidth = 50;
    const largeBoxWidth = 128;
    const boxGap = 2;
    const totalHeaderWidth = smallBoxWidth + boxGap + largeBoxWidth;
    const headerStartX = PAGE_CENTER - (totalHeaderWidth / 2);

    doc.rect(headerStartX, 45, smallBoxWidth, 28); 
    doc.setFont('helvetica', 'bold');
    
    let numSize = 66; 
    let symSize = 32;
    doc.setFontSize(numSize);
    let numWidth = doc.getTextWidth(comboNumber);
    doc.setFontSize(symSize);
    let symWidth = comboSymbol ? doc.getTextWidth(comboSymbol) : 0;
    
    let totalComboWidth = numWidth + symWidth + (comboSymbol ? 1 : 0);
    while (totalComboWidth > 47 && numSize > 30) {
      numSize -= 2;
      doc.setFontSize(numSize);
      numWidth = doc.getTextWidth(comboNumber);
      symSize = Math.max(16, numSize * 0.5);
      doc.setFontSize(symSize);
      symWidth = comboSymbol ? doc.getTextWidth(comboSymbol) : 0;
      totalComboWidth = numWidth + symWidth + (comboSymbol ? 1 : 0);
    }
    
    const smallBoxCenterX = headerStartX + (smallBoxWidth / 2);
    
    if (comboNumber === 'LLEVANDO') {
      // Special vertical layout: [LLEVANDO] [2] [UNIDADES]
      const numVal = parseInt(subCombo.split(' ')[0]);
      const unitText = numVal === 1 ? 'UNIDAD' : 'UNIDADES';
      
      doc.setFontSize(14);
      doc.text('LLEVANDO', smallBoxCenterX, 54, { align: 'center' });
      doc.setFontSize(50);
      doc.text(numVal.toString(), smallBoxCenterX, 66, { align: 'center' });
      doc.setFontSize(12);
      doc.text(unitText, smallBoxCenterX, 71, { align: 'center' });
    } else {
      // Standard layout
      let numSize = 66; 
      let symSize = 32;
      doc.setFontSize(numSize);
      let numWidth = doc.getTextWidth(comboNumber);
      
      // Safety check for very long text in standard layout
      while (numWidth > 45 && numSize > 20) {
        numSize -= 4;
        doc.setFontSize(numSize);
        numWidth = doc.getTextWidth(comboNumber);
      }

      doc.setFontSize(symSize);
      let symWidth = comboSymbol ? doc.getTextWidth(comboSymbol) : 0;
      
      let totalComboWidth = numWidth + symWidth + (comboSymbol ? 1 : 0);
      while (totalComboWidth > 47 && numSize > 30) {
        numSize -= 2;
        doc.setFontSize(numSize);
        numWidth = doc.getTextWidth(comboNumber);
        symSize = Math.max(16, numSize * 0.5);
        doc.setFontSize(symSize);
        symWidth = comboSymbol ? doc.getTextWidth(comboSymbol) : 0;
        totalComboWidth = numWidth + symWidth + (comboSymbol ? 1 : 0);
      }
      
      const comboStartX = smallBoxCenterX - (totalComboWidth / 2);
      
      doc.setFontSize(numSize);
      doc.text(comboNumber, comboStartX, 65); 
      if (comboSymbol) {
        doc.setFontSize(symSize);
        doc.text(comboSymbol, comboStartX + numWidth + 1, 65);
      }
      if (subCombo) {
        doc.setFontSize(16);
        doc.text(subCombo, smallBoxCenterX, 72, { align: 'center' });
      }
    }

    const largeBoxStartX = headerStartX + smallBoxWidth + boxGap;
    const largeBoxCenterX = largeBoxStartX + (largeBoxWidth / 2);
    doc.setDrawColor(0);
    doc.setLineWidth(1.4);
    doc.rect(largeBoxStartX, 45, largeBoxWidth, 28, 'S');
    doc.setTextColor(0, 0, 0); 
    
    let legend1Size = 30;
    const legend1Text = 'AHORRÁ CON TU COMPRA';
    doc.setFontSize(legend1Size);
    while (doc.getTextWidth(legend1Text) > (largeBoxWidth - 10) && legend1Size > 12) {
      legend1Size -= 1;
      doc.setFontSize(legend1Size);
    }
    doc.text(legend1Text, largeBoxCenterX, 58, { align: 'center' });
    
    let legend2Size = 20;
    const legend2Text = 'PAGÁS CADA UNO';
    doc.setFontSize(legend2Size);
    while (doc.getTextWidth(legend2Text) > (largeBoxWidth - 10) && legend2Size > 10) {
      legend2Size -= 1;
      doc.setFontSize(legend2Size);
    }
    doc.text(legend2Text, largeBoxCenterX, 68, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);

    // --- Legal & Title ---
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Ver legales de esta promoción en diaonline.com.ar', PAGE_CENTER, 80, { align: 'center' });
    
    const hasCashback = !!item.cashbackPrice;
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    let headerTitle = hasCashback ? `Precio con ${item.cashbackLabel} (-${item.cashbackPercentage})` : 'Precio con descuento';
    if (requiredUnits > 0) {
       headerTitle += ` LLEVANDO ${requiredUnits} UNIDADES`;
    }
    
    let hFontSize = 28;
    doc.setFontSize(hFontSize);
    while (doc.getTextWidth(headerTitle) > 195 && hFontSize > 16) {
      hFontSize -= 1;
      doc.setFontSize(hFontSize);
    }
    doc.text(headerTitle, PAGE_CENTER, 92, { align: 'center' });
    
    if (hasCashback && item.cashbackDay) {
      const dayText = `VÁLIDO: ${item.cashbackDay.toUpperCase()}`;
      doc.setFontSize(22);
      const dayW = doc.getTextWidth(dayText) + 8;
      const dayH = 8;
      doc.setDrawColor(0);
      doc.setLineWidth(0.8);
      (doc as any).roundedRect(PAGE_CENTER - (dayW / 2), 95, dayW, dayH, 2.5, 2.5, 'S');
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.text(dayText, PAGE_CENTER, 101, { align: 'center' });
    }

    if (hasCashback && item.cashbackCondition) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(14);
      const condY = item.cashbackDay ? 108 : 100;
      doc.text(item.cashbackCondition, PAGE_CENTER, condY, { align: 'center' });
    }

    // --- MAIN GIGANTIC PRICE ---
    const displayPrice = hasCashback ? (item.cashbackPrice || 0) : item.precioFinal;
    const priceFull = Math.floor(displayPrice).toString();
    const maxFontSize = priceFull.length >= 3 ? 230 : 280;
    doc.setFontSize(maxFontSize);
    let fontSize = maxFontSize; 
    let priceWidth = doc.getTextWidth(priceFull);
    while (priceWidth > 175 && fontSize > 100) {
      fontSize -= 5;
      doc.setFontSize(fontSize);
      priceWidth = doc.getTextWidth(priceFull);
    }
    const priceBaselineY = 185; 
    const priceStartX = PAGE_CENTER - (priceWidth / 2);
    doc.setFontSize(70);
    doc.text('$', priceStartX - 14, priceBaselineY); 
    doc.setFontSize(fontSize);
    doc.text(priceFull, PAGE_CENTER, priceBaselineY, { align: 'center' });

    // --- PRODUCT DESCRIPTION ---
    doc.setFont('helvetica', 'normal');
    let descSize = 54;
    doc.setFontSize(descSize);
    let splitTitle = doc.splitTextToSize(item.articulo.toUpperCase(), 185);
    while (splitTitle.length > 2 && descSize > 30) {
      descSize -= 2;
      doc.setFontSize(descSize);
      splitTitle = doc.splitTextToSize(item.articulo.toUpperCase(), 185);
    }
    if (splitTitle.length > 2) splitTitle = splitTitle.slice(0, 2);
    doc.text(splitTitle, PAGE_CENTER, 205, { align: 'center' });

    // --- BOTTOM SECTION ---
    const bottomY = 245;
    doc.setDrawColor(0);
    doc.setLineWidth(0.4);

    if (hasCashback) {
      // MODE PRO
      const hasAntes = item.precioOriginal && item.precioOriginal !== '0' && item.precioOriginal !== '0,00' && item.precioOriginal !== '';
      
      const box1W = 85;
      const box1H = 40;
      const box1X = hasAntes ? 15 : (PAGE_CENTER - box1W / 2);
      
      (doc as any).roundedRect(box1X, bottomY, box1W, box1H, 5, 5, 'S');
      
      const label1W = 45;
      const label1H = 7;
      const label1X = box1X + (box1W / 2) - (label1W / 2);
      const label1Y = bottomY - (label1H / 2);
      doc.setFillColor(255);
      (doc as any).roundedRect(label1X, label1Y, label1W, label1H, 3.5, 3.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('OFERTA DIA', box1X + (box1W / 2), bottomY + 1.5, { align: 'center' });
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(26);
      doc.text('$', box1X + 4, bottomY + 22);
      
      doc.setFontSize(62); 
      const diaPriceText = Math.floor(item.precioFinal).toString();
      const dpWidth = doc.getTextWidth(diaPriceText);
      const dpXStart = box1X + (box1W / 2) - (dpWidth / 2);
      doc.text(diaPriceText, dpXStart, bottomY + 25);
      doc.setFontSize(14);
      doc.text('C /U', dpXStart + dpWidth + 3, bottomY + 25);
      
      doc.setFontSize(10);
      doc.text(`precio sin reintegro de ${item.cashbackLabel}`, box1X + (box1W / 2), bottomY + 34, { align: 'center' });
      
      if (hasAntes) {
        // BOX 2: ANTES
        doc.setFontSize(28);
        const opWidth = doc.getTextWidth(item.precioOriginal);
        doc.setFontSize(16);
        const symW = doc.getTextWidth('$');
        doc.setFontSize(12);
        const cuW = doc.getTextWidth('C /U');
        
        const totalContentW = symW + 3 + opWidth + 3 + cuW;
        const box2W = Math.max(45, totalContentW + 10);
        const box2H = 25;
        const box2X = box1X + box1W + 10;
        const box2Y = bottomY + 15;
        
        (doc as any).roundedRect(box2X, box2Y, box2W, box2H, 3, 3, 'S');
        
        const label2W = 20;
        const label2H = 5;
        const label2X = box2X + (box2W / 2) - (label2W / 2);
        const label2Y = box2Y - (label2H / 2);
        doc.setFillColor(255);
        (doc as any).roundedRect(label2X, label2Y, label2W, label2H, 2.5, 2.5, 'FD');
        doc.setFontSize(9);
        doc.text('ANTES', box2X + (box2W / 2), box2Y + 1, { align: 'center' });
        
        const groupStartX = box2X + (box2W / 2) - (totalContentW / 2);
        doc.setFontSize(16);
        doc.text('$', groupStartX, box2Y + 18);
        doc.setFontSize(28);
        doc.text(item.precioOriginal, groupStartX + symW + 3, box2Y + 18);
        doc.setFontSize(12);
        doc.text('C /U', groupStartX + symW + 3 + opWidth + 3, box2Y + 18);
        
        doc.setLineWidth(0.6);
        doc.line(box2X + 3, box2Y + 21, box2X + box2W - 3, box2Y + 8);
      }
    } else {
      // MODE BASIC
      const hasAntes = item.precioOriginal && item.precioOriginal !== '0' && item.precioOriginal !== '0,00' && item.precioOriginal !== '';
      
      if (hasAntes) {
        const antesX = 15;
        const antesW = 85;
        const antesH = 40;
        (doc as any).roundedRect(antesX, bottomY, antesW, antesH, 5, 5, 'S');
        
        const labelW = 45;
        const labelH = 7;
        const labelX = antesX + (antesW / 2) - (labelW / 2);
        const labelY = bottomY - (labelH / 2);
        doc.setFillColor(255);
        (doc as any).roundedRect(labelX, labelY, labelW, labelH, 3.5, 3.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('ANTES', antesX + (antesW / 2), bottomY + 1.5, { align: 'center' });
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(62);
        const opW = doc.getTextWidth(item.precioOriginal);
        doc.setFontSize(26);
        const sW = doc.getTextWidth('$');
        doc.setFontSize(18);
        const cW = doc.getTextWidth('C /U');
        
        const totalW = sW + 3 + opW + 3 + cW;
        const startX = antesX + (antesW / 2) - (totalW / 2);
        
        doc.setFontSize(26);
        doc.text('$', startX, bottomY + 22);
        doc.setFontSize(62); 
        doc.text(item.precioOriginal, startX + sW + 3, bottomY + 25);
        doc.setFontSize(18);
        doc.text('C /U', startX + sW + 3 + opW + 3, bottomY + 25);
        
        doc.setLineWidth(0.8);
        doc.line(antesX + 5, bottomY + 30, antesX + antesW - 5, bottomY + 12);
      }
    }

    // --- METADATA ---
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    let validityText = `VIGENCIA: ${item.desde} AL ${item.hasta}`;
    doc.text(validityText, 15, 290);
    doc.text(`cod.${item.codigo}`, 190, 290, { align: 'right' });
  });

  if (previewOnly) {
    return doc.output('datauristring');
  } else {
    const timestamp = new Date().getTime();
    doc.save(`carteles_dia_final_${timestamp}.pdf`);
  }
};
