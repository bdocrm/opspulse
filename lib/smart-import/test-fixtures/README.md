`msoffcrypto-agile.xlsx` is the public, MIT-licensed `example_password.xlsx`
fixture from [msoffcrypto-tool](https://github.com/nolze/msoffcrypto-tool).
It is not a customer workbook. Its published test password is `Password1234_`.

Source: https://github.com/nolze/msoffcrypto-tool/blob/master/tests/inputs/example_password.xlsx

The expected decrypted output SHA-256 is
`4dd9dd0ccbfc7fb8769f1f3307830d3cc4c5042e32d619f4b2835fada89d13c6`,
verified against that project's `tests/outputs/example.xlsx`. OpsView tests
decrypt in memory and compare this known-output digest. No user password or
decrypted customer workbook is stored in these fixtures.
