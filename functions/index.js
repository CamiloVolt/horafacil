const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const MP_TOKEN = 'APP_USR-1134661133251593-032819-c88654e570bedeb5fc4242775187729e-415898030';

// Removendo .region() para usar a padrão do projeto e evitar erros de descoberta
exports.criarAssinaturaMP = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Usuário não autenticado.");
    }
    const { plano, preco } = data;
    const payerEmail = context.auth.token.email || "cliente_sem_email@horafacil.com";

    const body = {
        reason: `HoraFácil ${plano}`,
        auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: Number(preco),
            currency_id: "BRL"
        },
        back_url: "https://camilovolt.github.io/horafacil",
        payer_email: payerEmail
    };

    try {
        const res = await axios.post("https://api.mercadopago.com/preapproval", body, {
            headers: { "Authorization": `Bearer ${MP_TOKEN}` }
        });
        return res.data;
    } catch (error) {
        console.error("Erro MP:", error.response?.data || error.message);
        throw new functions.https.HttpsError("internal", "Erro ao gerar link de pagamento.");
    }
});

exports.verificarAssinaturaMP = functions.https.onCall(async (data, context) => {
    const { preapproval_id } = data;
    if (!preapproval_id) throw new functions.https.HttpsError("invalid-argument", "ID ausente.");

    try {
        const res = await axios.get(`https://api.mercadopago.com/preapproval/${preapproval_id}`, {
            headers: { "Authorization": `Bearer ${MP_TOKEN}` }
        });
        return res.data;
    } catch (error) {
        console.error("Erro MP Verificação:", error.response?.data || error.message);
        throw new functions.https.HttpsError("internal", "Erro ao verificar assinatura.");
    }
});

// aiChat v6 - com agendamento real via Firestore
exports.aiChat = functions.runWith({ secrets: ['GEMINI_API_KEY'] }).https.onCall(async (data, context) => {
    console.info("--- AI Chat v6 (Agendamento Real) ---");
    const { message, history, negocioData, negocioId } = data;

    if (!message || !negocioData || !negocioData.nome) {
        throw new functions.https.HttpsError("invalid-argument", "Dados incompletos.");
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new functions.https.HttpsError("internal", "Configuração pendente.");

    // Build typed service list
    const servicos = (negocioData.servicos && Array.isArray(negocioData.servicos))
        ? negocioData.servicos.map(s => typeof s === 'object' ? { nome: s.nome, preco: s.preco || 0 } : { nome: s, preco: 0 })
        : [];

    const servicosStr = servicos.length > 0
        ? servicos.map(s => `"${s.nome}" (R$ ${s.preco.toFixed(2)})`).join(', ')
        : "Não informados";

    const horariosStr = (negocioData.horarios && negocioData.horarios.inicio)
        ? `das ${negocioData.horarios.inicio} às ${negocioData.horarios.fim}`
        : "horário a confirmar";

    const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const todayBR  = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const systemPrompt = `Você é o assistente virtual de agendamento do negócio "${negocioData.nome}" (${negocioData.tipo || 'Serviços'}).

SERVIÇOS DISPONÍVEIS: ${servicosStr}
HORÁRIO DE FUNCIONAMENTO: ${horariosStr}
DATA DE HOJE: ${todayBR} (${todayISO})

SEU OBJETIVO: Ajudar o cliente a agendar. Quando o cliente quiser agendar, colete OBRIGATORIAMENTE em ordem:
1. Serviço desejado (deve ser um dos serviços listados acima)
2. Data e horário desejados (horário deve estar dentro do horário de funcionamento)
3. Nome completo do cliente
4. WhatsApp com DDD

REGRAS:
- Responda SEMPRE em PT-BR, de forma curta e amigável (máx 3 linhas).
- Não invente serviços, horários ou dados que não existem.
- Confirme todos os dados em uma mensagem antes de finalizar (ex: "Confirmar: Cabelo, dia 31/03 às 14h, para João — WhatsApp 11999998888?").
- Somente quando o cliente CONFIRMAR a reserva (disser "sim", "pode agendar", "confirmo", etc), coloque ISOLADO na Última linha da resposta, sem nenhum texto depois:
##BOOKING##
AGENDAR_JSON:{"servico":"NOME_EXATO","preco":PRECO_NUMERICO,"data":"YYYY-MM-DD","horario":"HH:MM","clienteNome":"NOME_COMPLETO","clienteWhatsapp":"SOMENTE_NUMEROS_COM_DDD"}

CONVERSÃO DE DATAS: hoje=${todayISO}. "Amanhã" = próximo dia. Formato obrigatório: YYYY-MM-DD.
CONVERSÃO DE HORÁRIO: "14h"→"14:00", "9h30"→"09:30". Formato: HH:MM.
WHATSAPP: apenas números, com DDD (ex: 11999998888).`;

    const contents = [
        { role: "user",  parts: [{ text: `INSTRUÇÕES DO SISTEMA:\n${systemPrompt}` }] },
        { role: "model", parts: [{ text: "Entendido! Pronto para ajudar com agendamentos." }] }
    ];

    if (history) history.forEach(h => contents.push(h));
    contents.push({ role: "user", parts: [{ text: message }] });

    try {
        console.info("Chamando Gemini...");
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            { contents },
            { headers: { "Content-Type": "application/json" } }
        );

        if (!res.data.candidates || !res.data.candidates[0].content) {
            throw new Error("Resposta inválida do Gemini");
        }

        let botText = res.data.candidates[0].content.parts[0].text;
        console.info("Resposta Gemini raw (primeiros 300 chars):", botText.substring(0, 300));

        // === ROBUST BOOKING DETECTION ===
        // Look for AGENDAR_JSON marker anywhere in the text (inline or separate line)
        const markerIdx = botText.indexOf('AGENDAR_JSON:');

        if (markerIdx !== -1) {
            // Extract the JSON string from after the marker
            const afterMarker = botText.slice(markerIdx + 'AGENDAR_JSON:'.length).trim();
            const braceStart = afterMarker.indexOf('{');
            const braceEnd   = afterMarker.lastIndexOf('}');

            // ALWAYS strip the marker and ##BOOKING## block from the displayed message
            botText = botText.slice(0, markerIdx).replace(/##BOOKING##\s*$/g, '').trim();

            // If no negocioId, we can't save — just return cleaned text
            if (!negocioId) {
                console.warn("AGENDAR_JSON detectado mas negocioId ausente — não salvando.");
                return { response: botText || "Agendamento processado!" };
            }

            if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) {
                console.error("AGENDAR_JSON malformado — sem JSON válido após o marcador.");
                return { response: botText || "Agendamento processado!" };
            }

            const jsonStr = afterMarker.slice(braceStart, braceEnd + 1);
            console.info("JSON extraído:", jsonStr);

            let bookingData;
            try { bookingData = JSON.parse(jsonStr); }
            catch (e) {
                console.error("Erro ao parsear JSON de agendamento:", jsonStr, e.message);
                return { response: botText || "Agendamento processado!" };
            }

            const { data: bookData, horario, clienteNome, clienteWhatsapp } = bookingData;
            if (!bookData || !horario || !clienteNome || !clienteWhatsapp) {
                console.warn("AGENDAR_JSON incompleto:", bookingData);
                return { response: botText || "Agendamento processado!" };
            }

            // Check if slot is already taken
            const db = admin.firestore();
            const existingSnap = await db.collection('agendamentos')
                .where('negocioId', '==', negocioId)
                .where('data', '==', bookData)
                .where('horario', '==', horario)
                .get();

            const existingActive = existingSnap.docs.filter(d => d.data().status !== 'cancelado');
            if (existingActive.length > 0) {
                return { response: `O horário ${horario} no dia ${bookData} já está reservado 😅 Gostaria de escolher outro horário?` };
            }

            // Check plan limit
            const negSnap = await db.collection('negocios').doc(negocioId).get();
            if (negSnap.exists) {
                const nd = negSnap.data();
                const limit = nd.plano === 'Pro' ? 50 : nd.plano === 'Premium' ? 99999 : 10;
                if ((nd.contagemMes || 0) >= limit) {
                    return { response: "Desculpe, o limite de agendamentos deste mês foi atingido. Entre em contato diretamente com o negócio." };
                }
            }

            // Find service from list
            const servicoMatch = servicos.find(s => s.nome.toLowerCase() === (bookingData.servico || '').toLowerCase())
                || { nome: bookingData.servico, preco: bookingData.preco || 0 };

            // Create booking in Firestore
            const novoAgendamento = {
                negocioId,
                clienteNome,
                clienteWhatsapp: clienteWhatsapp.toString().replace(/\D/g, ''),
                servicos: [servicoMatch],
                data: bookData,
                horario,
                paymentStatus: 'none',
                viaChat: true,
                criadoEm: admin.firestore.FieldValue.serverTimestamp()
            };

            const docRef = await db.collection('agendamentos').add(novoAgendamento);
            await db.collection('negocios').doc(negocioId).update({
                contagemMes: admin.firestore.FieldValue.increment(1)
            });

            console.info("✅ Agendamento via chat criado:", docRef.id);

            const [year, month, day] = bookData.split('-');
            const waText = `📅 Novo agendamento via Chat HoraFácil!\n*Nome:* ${clienteNome}\n*Serviço:* ${servicoMatch.nome} (R$ ${servicoMatch.preco.toFixed(2)})\n*Data:* ${day}/${month}/${year}\n*Horário:* ${horario}\n*WhatsApp:* ${novoAgendamento.clienteWhatsapp}`;

            return {
                response: botText,
                agendamentoConfirmado: true,
                agendamentoId: docRef.id,
                waText,
                whatsappDono: (negocioData.whatsapp || '').replace(/\D/g, '')
            };
        }

        return { response: botText };

    } catch (error) {
        console.error("Erro Fatal Chat:", error.response?.data || error.message);
        throw new functions.https.HttpsError("internal", "Erro de conexão com o cérebro da IA.");
    }
});
