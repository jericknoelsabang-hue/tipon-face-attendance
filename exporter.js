/* TIPON export v4.1.0. Five-column, styled XLSX written on-device.
 * No CDN, network request, login or changes to stored attendance/sync data.
 * XLSX is an Open XML package in a standards-compliant, uncompressed ZIP.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TIPONExport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='4.1.0';
  const HEADERS=Object.freeze(['MemberId','Date','Time In','Time Out','Date Time Out']);
  const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const DAY_MS=86400000, PH_OFFSET_MS=28800000;
  const encoder=new TextEncoder();
  const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const pad=n=>String(n).padStart(2,'0');
  function parts(value){
    if(value===null||value===undefined||value==='')return null;
    const ms=Date.parse(value);
    if(!Number.isFinite(ms))throw Error('Invalid attendance timestamp. Review the record before exporting.');
    // Read UTC components after a fixed Philippine offset; never use the browser timezone.
    const d=new Date(ms+PH_OFFSET_MS), y=d.getUTCFullYear(), m=d.getUTCMonth(), day=d.getUTCDate();
    const h=d.getUTCHours(), minute=d.getUTCMinutes(), s=d.getUTCSeconds();
    if(y<1900||y>9999)throw Error('Attendance date is outside the supported Excel date range.');
    return {date:`${pad(m+1)}/${pad(day)}/${y}`,time:`${pad(h)}:${pad(minute)}:${pad(s)}`,
      dateSerial:Date.UTC(y,m,day)/DAY_MS+25569,timeSerial:(h*3600+minute*60+s)/86400};
  }
  function table(data,numeric=false){
    if(!Array.isArray(data))throw Error('Attendance rows must be an array.');
    return [HEADERS.slice(),...data.map(row=>{
      if(row.memberId===null||row.memberId===undefined||String(row.memberId)==='')throw Error('A record has no MemberId. Review it before exporting.');
      const p=parts(row.timeIn), q=parts(row.timeOut);
      return [String(row.memberId),p?(numeric?p.dateSerial:p.date):'',p?(numeric?p.timeSerial:p.time):'',
        q?(numeric?q.timeSerial:q.time):'',q?(numeric?q.dateSerial:q.date):''];
    })];
  }
  const crcTable=Uint32Array.from({length:256},(_,n)=>{
    for(let k=0;k<8;k++)n=(n&1)?(0xEDB88320^(n>>>1)):(n>>>1);
    return n>>>0;
  });
  function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
  function join(chunks){const size=chunks.reduce((s,c)=>s+c.byteLength,0);if(size>0xFFFFFFFF)throw Error('Export exceeds ZIP size limit. Export a smaller date range.');const out=new Uint8Array(size);let p=0;for(const c of chunks){out.set(c,p);p+=c.byteLength;}return out;}
  function zip(files){
    const local=[],central=[];let offset=0;
    for(const [name,text] of files){
      const n=encoder.encode(name),b=encoder.encode(text),crc=crc32(b);
      const h=new Uint8Array(30),v=new DataView(h.buffer);
      v.setUint32(0,0x04034B50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);
      v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,b.length,true);v.setUint32(22,b.length,true);v.setUint16(26,n.length,true);
      local.push(h,n,b);
      const c=new Uint8Array(46),w=new DataView(c.buffer);
      w.setUint32(0,0x02014B50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);
      w.setUint16(14,33,true);w.setUint32(16,crc,true);w.setUint32(20,b.length,true);w.setUint32(24,b.length,true);w.setUint16(28,n.length,true);w.setUint32(42,offset,true);
      central.push(c,n);offset+=h.length+n.length+b.length;
    }
    const directory=join(central),end=new Uint8Array(22),v=new DataView(end.buffer);
    v.setUint32(0,0x06054B50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,directory.length,true);v.setUint32(16,offset,true);
    return join([...local,directory,end]);
  }
  function cell(ref,value,style){
    if(value===''||value===null||value===undefined)return `<c r="${ref}" s="${style}"/>`;
    if(typeof value==='number'){
      if(!Number.isFinite(value))throw Error('Non-finite value in attendance export.');
      return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    }
    // IDs remain literal text (including leading zeros and strings beginning with =).
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }
  function xlsx(data){
    if(data.length>1048575)throw Error('Too many rows for Excel. Export a smaller date range.');
    const values=table(data,true), count=values.length, columns=['A','B','C','D','E'];
    const body=values.map((row,i)=>`<row r="${i+1}" ht="${i===0?30:18}" customHeight="1">${row.map((v,c)=>cell(columns[c]+(i+1),v,i===0?1:([2,3,4,4,3][c]))).join('')}</row>`).join('');
    const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const sheet=declaration+`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E${count}"/><sheetViews><sheetView workbookViewId="0" showGridLines="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="4" width="20" customWidth="1"/><col min="5" max="5" width="22" customWidth="1"/></cols><sheetData>${body}</sheetData><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
    const styles=declaration+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="mm/dd/yyyy"/><numFmt numFmtId="165" formatCode="hh:mm:ss"/></numFmts>'+
      '<fonts count="2"><font><sz val="11"/><color rgb="FF000000"/><name val="Arial"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>'+
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF000000"/><bgColor indexed="64"/></patternFill></fill></fills>'+
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'+
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'+
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'+
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>'+
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    return zip([
      ['[Content_Types].xml',declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels',declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml',declaration+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="TIPON Attendance" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels',declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml',styles],['xl/worksheets/sheet1.xml',sheet]
    ]);
  }
  return Object.freeze({VERSION,HEADERS,MIME,parts,table,xlsx});
});
