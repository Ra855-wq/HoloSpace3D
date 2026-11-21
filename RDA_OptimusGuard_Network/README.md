# RDA OptimusGuard — Network Integrity

Projeto local, defensivo e independente para diagnóstico de conectividade com serviços OpenAI. Compatível com macOS, Windows e Linux. **Não precisa de bibliotecas externas.**

## Como abrir no Cursor

Abra esta pasta no Cursor (File → Open Folder). O Cursor não recebe acesso à rede ou à máquina automaticamente por este pacote.

## Executar (macOS)

```bash
python3 src/optimusguard.py --scan --out reports
```

Para analisar um HAR **exportado e higienizado**:

```bash
python3 src/optimusguard.py --har /caminho/arquivo-higienizado.har --out reports
```

Para executar ambos:

```bash
python3 src/optimusguard.py --scan --har /caminho/arquivo-higienizado.har --out reports
```

Abra `index.html` no navegador. Se a pasta for servida localmente, o painel lê `reports/latest.json` sozinho. Também é possível carregar esse arquivo pelo seletor. A página não faz requisições a outros sites.

## Saídas

- `network_*.csv`: estado DNS, TCP 443, TLS, HTTP HEAD por hostname.
- `har_summary_*.csv`: host, protocolo, status e duração — **sem URLs completas ou tokens**.
- `report_*.md`: laudo inicial com ressalvas técnicas e recomendação de comparação entre redes.
- `latest.json`: resultados para o painel HTML.

## Escopo e limitações

- Lista de referência: https://help.openai.com/pt-br/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps
- Verifica hosts concretos, inclusive representantes de padrões `*.`. Não comprova todos os subdomínios dos padrões.
- DNS, TCP 443 e TLS recebem `FAIL` na camada em que a conexão parou. `NOT_TESTED` significa que a camada anterior não passou.
- Um status HTTP 3xx é a resposta do próprio host. O programa não abre o endereço do redirecionamento.
- Teste HTTP HEAD pode retornar 403/404 sem que exista bloqueio de rede.
- Não verifica WebSocket por handshake, UDP 3478, políticas de proxy autenticado ou inspeção TLS transparente. O proxy definido no ambiente é usado na consulta HTTP, como o cliente Python padrão.
- O arquivo HAR de origem fica no computador do usuário; não é copiado para o relatório. Mesmo assim, examine relatórios antes de compartilhá-los.
- A análise dos HARs não exporta caminhos, parâmetros, corpos, cookies, tokens ou cabeçalhos. O hostname pode ser sensível em algumas organizações.
- Os testes devem ocorrer na rede investigada; um teste em outra rede não revela o estado da sua conexão Wi-Fi.

## Testes locais

```bash
python3 -m unittest discover -s tests -v
```

## Segurança

Somente solicitações DNS, TCP 443, TLS e HTTP HEAD para a lista fixa de hostnames, sem varredura de portas ou alterações na rede. A leitura de HAR não conecta nos hosts encontrados. Não inclua HAR bruto no repositório nem publique dados pessoais.
