# Teste de viabilidade no iPhone (para o dono)

Objetivo: descobrir se o iPhone 16e consegue rodar os modelos do Macrofy no Safari. Leva de 5 a 15
minutos e baixa algumas centenas de MB, então use o Wi-Fi. Spec: [SPEC-T-012](../specs/SPEC-T-012-browser-feasibility.md).

1. No Safari do iPhone, abra https://fabiohelper.github.io/artisan-studio/feasibility/
2. Toque em **Iniciar teste**. Não é preciso tirar foto: o teste usa uma imagem de exemplo.
3. Mantenha o Safari aberto e a tela ligada até aparecer "Pronto!" e o resultado (go ou no-go). A página recarrega sozinha entre as etapas para liberar memória: é normal.
4. Toque em **Copiar resultados**.
5. Cole o texto na conversa com o Claude.

Se a página recarregar ou o Safari fechar a aba no meio do teste:

- Abra o mesmo endereço de novo. A página mostra em qual etapa a aba foi encerrada.
- Ele continua sozinho (ou toque em **Continuar o teste**) com o próximo modelo da mesma etapa e depois com as etapas que faltam.
- No fim, toque em **Copiar resultados** e cole na conversa como acima. O resultado inclui o modelo que derrubou a aba. A profundidade é só informativa: o veredito depende da segmentação e dos nomes.

Dicas: feche outras abas e apps pesados antes; se aparecer erro de rede, tente de novo no Wi-Fi.
Opcional: escolha antes uma foto de um prato no campo de foto, em vez da imagem de exemplo.
Se quiser recomeçar do zero, toque em **Apagar resultados salvos**.
