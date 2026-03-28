function generatePixPayload(pixKey, merchantName, merchantCity, amount) {
    function crc16(payload) {
        let polynomial = 0x1021; let result = 0xFFFF;
        for (let i = 0; i < payload.length; i++) {
            result ^= (payload.charCodeAt(i) << 8);
            for (let j = 0; j < 8; j++) { if ((result & 0x8000) !== 0) { result = ((result << 1) ^ polynomial) & 0xFFFF; } else { result = (result << 1) & 0xFFFF; } }
        }
        return result.toString(16).toUpperCase().padStart(4, '0');
    }
    function formatF(id, val) { let vStr = val.toString(); return id + vStr.length.toString().padStart(2, '0') + vStr; }
    let safeKey = pixKey.trim(); let justNums = safeKey.replace(/\D/g, '');
    if (justNums.length === 13 && justNums.startsWith('55')) { safeKey = '+' + justNums; }
    else if (/^\(?\d{2}\)?\s*9?\d{4}-?\d{4}$/.test(safeKey)) { if (justNums.length === 10 || justNums.length === 11) { safeKey = '+55' + justNums; } }
    else { safeKey = safeKey.replace(/\s+/g, ''); }
    let payloadKey = formatF("00", "br.gov.bcb.pix") + formatF("01", safeKey);
    let p = formatF("00", "01") + formatF("26", payloadKey) + formatF("52", "0000") + formatF("53", "986") + (amount > 0 ? formatF("54", amount.toFixed(2)) : '');
    let safeName = merchantName.replace(/[^a-zA-Z0-9 ]/g, "").trim().substring(0, 25) || 'Vendedor';
    let safeCity = merchantCity.replace(/[^a-zA-Z0-9 ]/g, "").trim().substring(0, 15) || 'Cidade';
    p += formatF("58", "BR") + formatF("59", safeName) + formatF("60", safeCity) + formatF("62", formatF("05", "***")) + "6304";
    return p + crc16(p);
}
console.log(generatePixPayload('5511920075889', 'Nome Teste', 'Sao Paulo', 15.00));
