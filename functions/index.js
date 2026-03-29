const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { setGlobalOptions } = require("firebase-functions/v2");

// É recomendado definir a região mais próxima e ajustar instâncias conforme necessário
setGlobalOptions({ maxInstances: 10, region: "us-central1", invoker: "public" });

// O Token removido do frontend agora fica seguro no backend!
const MP_TOKEN = 'APP_USR-1134661133251593-032819-c88654e570bedeb5fc4242775187729e-415898030';

exports.criarAssinaturaMP = onCall(async (request) => {
    // 1. Validar Autenticação (Apenas usuários logados no Firebase no app frontend)
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "O usuário deve estar autenticado para assinar.");
    }

    // 2. Extrair dados passados pelo front
    const { plano, preco } = request.data;
    if (!plano || preco === undefined) {
        throw new HttpsError("invalid-argument", "Parâmetros 'plano' ou 'preco' faltando.");
    }

    // Obter email do usuário logado do firebase
    const payerEmail = request.auth.token.email || "cliente_sem_email@horafacil.com";

    // 3. Montar o payload para a API Preapproval do Mercado Pago
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

    logger.info(`Criando assinatura ${plano} para ${payerEmail}`);

    try {
        // Usar fetch nativo (disponível Node.js 18+)
        const res = await fetch("https://api.mercadopago.com/preapproval", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${MP_TOKEN}`
            },
            body: JSON.stringify(body)
        });

        const data = await res.json();
        
        if (!res.ok) {
            logger.error("Erro retornado pelo Mercado Pago:", JSON.stringify(data));
            throw new HttpsError("internal", "Falha ao gerar o link no servidor do Mercado Pago", data);
        }

        // Retorna pro front os dados (principalmente o init_point)
        return data; 
    } catch (error) {
        logger.error("Erro Inesperado na requisição:", error);
        throw new HttpsError("internal", "Erro de conexão interna.");
    }
});


exports.verificarAssinaturaMP = onCall(async (request) => {
    const { preapproval_id } = request.data;
    
    if (!preapproval_id) {
        throw new HttpsError("invalid-argument", "ID de preapproval ausente.");
    }

    try {
        const res = await fetch(`https://api.mercadopago.com/preapproval/${preapproval_id}`, {
            headers: { "Authorization": `Bearer ${MP_TOKEN}` }
        });
        const data = await res.json();
        
        if (!res.ok) {
            logger.error("Erro MP verificação:", JSON.stringify(data));
            throw new HttpsError("internal", "Falha ao verificar no Mercado Pago");
        }
        
        return data;
    } catch (error) {
         logger.error("Erro Inesperado na requisição de verificação:", error);
         throw new HttpsError("internal", "Erro de rede no servidor.");
    }
});
