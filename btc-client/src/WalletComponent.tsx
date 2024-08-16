import { ec as EC } from "elliptic"
import crypto from "crypto"

interface UTXO {
  txid: string
  vout: number
  amount: number
}

interface TransactionInput {
  txid: string
  vout: number
  scriptSig: string
}

interface TransactionOutput {
  address: string
  amount: number
}

interface Transaction {
  inputs: TransactionInput[]
  outputs: TransactionOutput[]
}

class BitcoinWallet {
  private ec: EC
  private keyPair: EC.KeyPair
  public address: string
  private utxos: UTXO[] = [] // Store the wallet's UTXOs

  constructor() {
    this.ec = new EC("secp256k1")
    this.keyPair = this.ec.genKeyPair()
    this.address = this.generateAddress()
  }

  private generateAddress(): string {
    const publicKey = this.keyPair.getPublic().encode("hex", true)
    const sha256 = crypto
      .createHash("sha256")
      .update(Buffer.from(publicKey, "hex"))
      .digest()
    const ripemd160 = crypto.createHash("ripemd160").update(sha256).digest()
    return ripemd160.toString("hex")
  }

  public getPrivateKey(): string {
    return this.keyPair.getPrivate("hex")
  }

  public getPublicKey(): string {
    return this.keyPair.getPublic("hex")
  }

  public addUTXO(utxo: UTXO) {
    this.utxos.push(utxo)
  }

  public getBalance(): number {
    return this.utxos.reduce((sum, utxo) => sum + utxo.amount, 0)
  }

  public createTransaction(
    recipientAddress: string,
    amount: number
  ): Transaction | null {
    const inputs: TransactionInput[] = []
    const outputs: TransactionOutput[] = []
    let inputSum = 0

    // Select UTXOs as inputs
    for (const utxo of this.utxos) {
      inputSum += utxo.amount
      inputs.push({
        txid: utxo.txid,
        vout: utxo.vout,
        scriptSig: "", // We'll fill this with the signature later
      })
      if (inputSum >= amount) break
    }

    if (inputSum < amount) {
      console.error("Insufficient funds")
      return null
    }

    // Create the outputs
    outputs.push({ address: recipientAddress, amount })
    if (inputSum > amount) {
      // Return change to sender
      outputs.push({ address: this.address, amount: inputSum - amount })
    }

    const transaction: Transaction = { inputs, outputs }

    // Sign each input
    transaction.inputs.forEach((input, index) => {
      const signatureHash = this.calculateSignatureHash(transaction, index)
      const signature = this.keyPair.sign(signatureHash)
      input.scriptSig = signature.toDER("hex")
    })

    // Remove spent UTXOs
    this.utxos = this.utxos.slice(inputs.length)

    return transaction
  }

  private calculateSignatureHash(
    transaction: Transaction,
    inputIndex: number
  ): string {
    // This is a simplified version. In real Bitcoin, the signature hash calculation is more complex.
    const txCopy = JSON.parse(JSON.stringify(transaction))
    txCopy.inputs.forEach((input: any, i: number) => {
      input.scriptSig = i === inputIndex ? "PREVIOUS_PUBKEY" : ""
    })
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(txCopy))
      .digest("hex")
  }
}

// Usage in React component
import React, { useState } from "react"
import axios from "axios"

const WalletComponent: React.FC = () => {
  const [wallet, setWallet] = useState<BitcoinWallet | null>(null)
  const [recipientAddress, setRecipientAddress] = useState("")
  const [amount, setAmount] = useState("")
  const [transactionStatus, setTransactionStatus] = useState("")

  const createWallet = () => {
    const newWallet = new BitcoinWallet()
    // For demonstration, let's add some initial UTXOs
    newWallet.addUTXO({ txid: "initial1", vout: 0, amount: 5 })
    newWallet.addUTXO({ txid: "initial2", vout: 1, amount: 3 })
    setWallet(newWallet)
  }

  const sendTransaction = async () => {
    if (!wallet) {
      setTransactionStatus("Wallet not created. Please create a wallet first.")
      return
    }

    const transaction = wallet.createTransaction(
      recipientAddress,
      parseFloat(amount)
    )
    if (!transaction) {
      setTransactionStatus("Failed to create transaction. Insufficient funds?")
      return
    }

    try {
      const response = await axios.post(
        "http://localhost:3000/transaction",
        transaction
      )
      setTransactionStatus(`Transaction sent: ${JSON.stringify(response.data)}`)
    } catch (error) {
      setTransactionStatus(`Error sending transaction: ${error}`)
    }
  }

  return (
    <div>
      <h1>Bitcoin-like Wallet</h1>
      {wallet ? (
        <div>
          <p>Wallet Address: {wallet.address}</p>
          <p>Balance: {wallet.getBalance()}</p>
          <input
            type="text"
            placeholder="Recipient Address"
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
          />
          <input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button onClick={sendTransaction}>Send Transaction</button>
        </div>
      ) : (
        <button onClick={createWallet}>Create Wallet</button>
      )}
      {transactionStatus && <p>{transactionStatus}</p>}
    </div>
  )
}

export default WalletComponent
