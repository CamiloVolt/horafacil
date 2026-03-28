function crc16(payload) {
    let polynomial = 0x1021; let result = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
        result ^= (payload.charCodeAt(i) << 8);
        for (let j = 0; j < 8; j++) { if ((result & 0x8000) !== 0) { result = ((result << 1) ^ polynomial) & 0xFFFF; } else { result = (result << 1) & 0xFFFF; } }
    }
    return result.toString(16).toUpperCase().padStart(4, '0');
}
console.log(crc16('00020126330014br.gov.bcb.pix0111123456789095204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'));
