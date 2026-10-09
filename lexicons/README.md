# Development Lexicons

The checked-in schemas use the reserved `invalid` DNS suffix and are examples only. Set
`LEXICON_NAMESPACE` to a reverse-DNS namespace whose domain you control before a real
deployment, rename the schema IDs/files to match, and publish them from the owning AT
Protocol repository with the required `_lexicon` DNS record. The service never claims
or publishes these development IDs automatically.
