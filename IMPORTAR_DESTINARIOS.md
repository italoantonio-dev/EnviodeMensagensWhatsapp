# Guia de Importação de Destinatários

## Formatos Suportados

A funcionalidade de importação suporta 3 formatos de arquivo:

### 1. **JSON** (.json)

Estrutura esperada: Array de objetos com propriedades `name`, `type` e `destination`.

**Exemplo:**
```json
[
  {
    "name": "João Silva",
    "type": "private",
    "destination": "5534988776655"
  },
  {
    "name": "Equipe Vendas",
    "type": "group",
    "destination": "120363331234567890@g.us"
  }
]
```

**Campos:**
- `name` (obrigatório): Nome do destinatário
- `type` (obrigatório): `private` ou `group`
- `destination` (obrigatório): 
  - Tipo private: Número com DDI (ex: 5534988776655)
  - Tipo group: ID do grupo com @g.us ou link de convite

### 2. **XML** (.xml)

Estrutura esperada: Elemento raiz `<recipients>` contendo múltiplos elementos `<recipient>`.

**Exemplo:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<recipients>
  <recipient>
    <name>João Silva</name>
    <type>private</type>
    <destination>5534988776655</destination>
  </recipient>
  <recipient>
    <name>Equipe Vendas</name>
    <type>group</type>
    <destination>120363331234567890@g.us</destination>
  </recipient>
</recipients>
```

### 3. **Excel** (.xlsx ou .xls)

A primeira aba do arquivo Excel deve conter colunas com os seguintes nomes:
- `name` ou `Nome`
- `type` ou `Tipo`
- `destination` ou `Destino` ou `numero` ou `Number`

**Exemplo:** Veja o template em `exemplo-destinarios.xlsx`

## Nomes Alternativos de Campos

O sistema reconhece nomes alternativos para maior flexibilidade:

| Padrão | Alternativas |
|--------|--------------|
| `name` | `nome` |
| `type` | `tipo` |
| `destination` | `destino`, `numero`, `number` |

**Exemplo JSON alternativo:**
```json
[
  {
    "nome": "João Silva",
    "tipo": "private",
    "numero": "5534988776655"
  }
]
```

## Como Usar

1. Acesse a seção **Destinatários** no painel
2. Clique no botão **Importar de arquivo**
3. Selecione o arquivo JSON, XML ou Excel
4. O sistema processará e exibirá:
   - Quantidade de destinatários importados
   - Quantidade de duplicatas encontradas
   - Quantidade de erros

## Validações

**O sistema valida:**
- Nome não pode estar vazio
- Tipo deve ser `private` ou `group`
- Destino é obrigatório
- Números devem estar em formato válido (não aceita caracteres especiais)
- Grupos devem ter ID com @g.us ou ser um link de convite válido
- Não permite duplicatas (mesmo JID)

## Arquivos de Exemplo

- `exemplo-destinarios.json` - Modelo em JSON
- `exemplo-destinarios.xml` - Modelo em XML

## Dicas

1. **Para grupos privados:** Use o ID do grupo terminado em `@g.us`
   - Exemplo: `120363331234567890@g.us`

2. **Para grupos de links:** Cole o link de convite completo
   - Exemplo: `https://chat.whatsapp.com/CÓDIGO`

3. **Números:** Sempre use o formato internacional
   - Exemplo: `5534988776655` (país=55, DDD=34, número=988776655)

4. **Erros:** Verifique a coluna "Erro" para identificar linhas com problemas

5. **Duplicatas:** Se um destinatário com o mesmo JID já existe, ele será listado como duplicata e não será reimportado
