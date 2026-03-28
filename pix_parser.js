function parsePix(pix) {
    if (!pix.endsWith(crc16(pix.substring(0, pix.length - 4)))) {
        console.log('CRC MATCHER FAILED');
    } else {
        console.log('CRC MATCHER OK');
    }
    
    let i = 0;
    while(i < pix.length - 4) {
        let id = pix.substring(i, i+2);
        let len = parseInt(pix.substring(i+2, i+4), 10);
        let val = pix.substring(i+4, i+4+len);
        console.log(id + ' -> (len ' + len + ') : ' + val);
        i = i + 4 + len;
    }
}
function crc16(payload) {
    let polynomial = 0x1021; let result = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
        result ^= (payload.charCodeAt(i) << 8);
        for (let j = 0; j < 8; j++) { if ((result & 0x8000) !== 0) { result = ((result << 1) ^ polynomial) & 0xFFFF; } else { result = (result << 1) & 0xFFFF; } }
    }
    return result.toString(16).toUpperCase().padStart(4, '0');
}
let pix = '00020126360014br.gov.bcb.pix0114+5511920075889520400005303986540515.005802BR5910Nome Teste6009Sao Paulo62070503***6304381D';
parsePix(pix);
