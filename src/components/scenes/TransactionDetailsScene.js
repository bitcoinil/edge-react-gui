// @flow

import { abs, bns, sub } from 'biggystring'
import type { EdgeCurrencyInfo, EdgeDenomination, EdgeMetadata, EdgeTransaction } from 'edge-core-js'
import * as React from 'react'
import { Image, Linking, Platform, ScrollView, TouchableWithoutFeedback, View } from 'react-native'
import Mailer from 'react-native-mail'
import SafariView from 'react-native-safari-view'
import FontAwesomeIcon from 'react-native-vector-icons/FontAwesome'
import IonIcon from 'react-native-vector-icons/Ionicons'
import { connect } from 'react-redux'
import { sprintf } from 'sprintf-js'

import { getSubcategories, setNewSubcategory, setTransactionDetails } from '../../actions/TransactionDetailsActions.js'
import * as Constants from '../../constants/indexConstants'
import { formatNumber } from '../../locales/intl.js'
import s from '../../locales/strings.js'
import { getDisplayDenomination, getPlugins, getSettings } from '../../modules/Settings/selectors.js'
import { convertCurrencyFromExchangeRates, convertNativeToExchangeRateDenomination, getSelectedWallet, getWallet } from '../../modules/UI/selectors.js'
import { type Dispatch, type RootState } from '../../types/reduxTypes.js'
import type { GuiContact, GuiWallet } from '../../types/types.js'
import * as UTILS from '../../util/utils.js'
import { SceneWrapper } from '../common/SceneWrapper.js'
import { RawTextModal } from '../modals/RawTextModal.js'
import { TransactionAccelerateModal } from '../modals/TransactionAccelerateModal.js'
import { TransactionAdvanceDetails } from '../modals/TransactionAdvanceDetails.js'
import { TransactionDetailsCategoryInput } from '../modals/TransactionDetailsCategoryInput.js'
import { TransactionDetailsFiatInput } from '../modals/TransactionDetailsFiatInput.js'
import { TransactionDetailsNotesInput } from '../modals/TransactionDetailsNotesInput.js'
import { TransactionDetailsPersonInput } from '../modals/TransactionDetailsPersonInput.js'
import { Airship, showError } from '../services/AirshipInstance.js'
import { type Theme, type ThemeProps, cacheStyles, withTheme } from '../services/ThemeContext.js'
import { EdgeText } from '../themed/EdgeText.js'
import { PrimaryButton } from '../themed/ThemedButtons.js'
import { Tile } from '../themed/Tile.js'

type OwnProps = {
  edgeTransaction: EdgeTransaction,
  thumbnailPath?: string
}
type StateProps = {
  contacts: GuiContact[],
  currencyCode: string,
  currencyInfo?: EdgeCurrencyInfo,
  currentFiatAmount: number,
  destinationDenomination?: EdgeDenomination,
  destinationWallet?: GuiWallet,
  guiWallet: GuiWallet,
  subcategoriesList: string[],
  walletDefaultDenomProps: EdgeDenomination
}
type DispatchProps = {
  getSubcategories(): void,
  setNewSubcategory(newSubcategory: string): void,
  setTransactionDetails(transaction: EdgeTransaction, edgeMetadata: EdgeMetadata): void
}
type Props = OwnProps & StateProps & DispatchProps & ThemeProps

type State = {
  payeeName: string, // remove commenting once metaData in Redux
  thumbnailPath?: string,
  notes: string,
  amountFiat: string,
  direction: string,
  bizId: number,
  miscJson: any, // core receives this as a string
  category: string,
  subCategory: string
}

const categories = {
  exchange: {
    syntax: s.strings.fragment_transaction_exchange,
    key: 'exchange'
  },
  expense: {
    syntax: s.strings.fragment_transaction_expense,
    key: 'expense'
  },
  transfer: {
    syntax: s.strings.fragment_transaction_transfer,
    key: 'transfer'
  },
  income: {
    syntax: s.strings.fragment_transaction_income,
    key: 'income'
  }
}

type FiatCryptoAmountUI = {
  amountString: string,
  symbolString: string,
  currencyName: string,
  feeString: string
}

type FiatCurrentAmountUI = {
  amount: string,
  difference: number,
  percentage: string
}

// Only exported for unit-testing purposes
export class TransactionDetailsComponent extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    const { thumbnailPath } = props
    const edgeTransaction = {
      ...props.edgeTransaction,
      date: UTILS.autoCorrectDate(props.edgeTransaction.date)
    }
    const direction = parseInt(edgeTransaction.nativeAmount) >= 0 ? 'receive' : 'send'
    const category = this.initializeFormattedCategories(edgeTransaction.metadata, direction)

    this.state = {
      amountFiat: this.initalizeAmountBalance(edgeTransaction.metadata),
      payeeName: edgeTransaction.metadata && edgeTransaction.metadata.name ? edgeTransaction.metadata.name : '', // remove commenting once metaData in Redux
      notes: edgeTransaction.metadata && edgeTransaction.metadata.notes ? edgeTransaction.metadata.notes : '',
      category: category.category,
      subCategory: category.subCategory,
      thumbnailPath,
      direction,
      bizId: 0,
      miscJson: edgeTransaction.metadata ? edgeTransaction.metadata.miscJson : ''
    }
  }

  initalizeAmountBalance = (metadata: ?EdgeMetadata) => {
    if (metadata && metadata.amountFiat) {
      const initialAmount = metadata.amountFiat.toFixed(2)
      const absoluteAmount = bns.abs(initialAmount)
      return formatNumber(bns.toFixed(absoluteAmount, 2, 2), { noGrouping: true })
    }
    return formatNumber('0.00')
  }

  initializeFormattedCategories = (metadata: ?EdgeMetadata, direction: string) => {
    const defaultCategory = direction === 'receive' ? categories.income.key : categories.expense.key
    if (metadata) {
      const fullCategory = metadata.category || ''
      const colonOccurrence = fullCategory.indexOf(':')
      if (fullCategory && colonOccurrence) {
        const splittedFullCategory = UTILS.splitTransactionCategory(fullCategory)
        const { subCategory } = splittedFullCategory
        const category = splittedFullCategory.category.toLowerCase()
        return {
          category: categories[category] ? categories[category].key : defaultCategory,
          subCategory
        }
      }
    }
    return { category: defaultCategory, subCategory: '' }
  }

  componentDidMount() {
    this.props.getSubcategories()
  }

  // Inputs Components
  onChangePayee = (payeeName: string, thumbnailPath?: string) => {
    this.setState({ payeeName, thumbnailPath })
  }

  openPersonInput = () => {
    const personLabel = this.state.direction === 'receive' ? s.strings.transaction_details_payer : s.strings.transaction_details_payee
    Airship.show(bridge => (
      <TransactionDetailsPersonInput
        bridge={bridge}
        personStatus={personLabel}
        personName={this.state.payeeName}
        onChangePerson={this.onChangePayee}
        contacts={this.props.contacts}
      />
    )).then(_ => {})
  }

  onChangeFiat = (amountFiat: string) => this.setState({ amountFiat })
  openFiatInput = () => {
    Airship.show(bridge => (
      <TransactionDetailsFiatInput
        bridge={bridge}
        currency={this.props.guiWallet.fiatCurrencyCode}
        amount={this.state.amountFiat}
        onChange={this.onChangeFiat}
      />
    )).then(_ => {})
  }

  onChangeCategory = (category: string, subCategory: string) => this.setState({ category, subCategory })
  openCategoryInput = () => {
    Airship.show(bridge => (
      <TransactionDetailsCategoryInput
        bridge={bridge}
        categories={categories}
        subCategories={this.props.subcategoriesList}
        category={this.state.category}
        subCategory={this.state.subCategory}
        setNewSubcategory={this.props.setNewSubcategory}
        onChange={this.onChangeCategory}
      />
    )).then(_ => {})
  }

  onChangeNotes = (notes: string) => this.setState({ notes })
  openNotesInput = () => {
    Airship.show(bridge => (
      <TransactionDetailsNotesInput
        bridge={bridge}
        title={s.strings.transaction_details_notes_title}
        placeholder={s.strings.transaction_details_notes_title}
        notes={this.state.notes}
        onChange={this.onChangeNotes}
      />
    )).then(_ => {})
  }

  openAccelerateModel = () => {
    const { edgeTransaction } = this.props
    const { wallet } = edgeTransaction

    if (wallet) {
      Airship.show(bridge => <TransactionAccelerateModal bridge={bridge} edgeTransaction={edgeTransaction} wallet={wallet} />)
    } else {
      showError(new Error('Transaction is missing wallet data.'))
    }
  }

  openAdvancedDetails = async () => {
    const { currencyInfo } = this.props

    Airship.show(bridge => (
      <TransactionAdvanceDetails
        bridge={bridge}
        feeRateUsed={this.props.edgeTransaction.feeRateUsed}
        networkFeeOption={this.props.edgeTransaction.networkFeeOption}
        requestedCustomFee={this.props.edgeTransaction.requestedCustomFee}
        signedTx={this.props.edgeTransaction.signedTx}
        txid={this.props.edgeTransaction.txid}
        txSecret={this.props.edgeTransaction.txSecret}
        recipientAddress={this.props.edgeTransaction.spendTargets ? this.props.edgeTransaction.spendTargets[0].publicAddress : ''}
        url={currencyInfo ? sprintf(currencyInfo.transactionExplorer, this.props.edgeTransaction.txid) : undefined}
      />
    ))
  }

  renderExchangeData = (symbolString: string) => {
    const { destinationDenomination, destinationWallet, edgeTransaction, guiWallet, walletDefaultDenomProps, theme } = this.props
    const { swapData, spendTargets } = edgeTransaction
    const styles = getStyles(theme)

    if (!swapData || !spendTargets || !destinationDenomination) return null

    const { plugin, isEstimate, orderId, payoutAddress, refundAddress } = swapData
    const sourceAmount = UTILS.convertNativeToDisplay(walletDefaultDenomProps.multiplier)(spendTargets[0].nativeAmount)
    const destinationAmount = UTILS.convertNativeToDisplay(destinationDenomination.multiplier)(swapData.payoutNativeAmount)
    const destinationCurrencyCode = swapData.payoutCurrencyCode

    const createExchangeDataString = (newline: string = '\n') => {
      const destinationWalletName = destinationWallet ? destinationWallet.name : ''
      const uniqueIdentifier = spendTargets && spendTargets[0].uniqueIdentifier ? spendTargets[0].uniqueIdentifier : ''
      const exchangeAddresses =
        spendTargets && spendTargets.length > 0
          ? spendTargets.map((target, index) => `${target.publicAddress}${index + 1 !== spendTargets.length ? newline : ''}`).toString()
          : ''

      return `${s.strings.transaction_details_exchange_service}: ${plugin.displayName}${newline}${s.strings.transaction_details_exchange_order_id}: ${
        orderId || ''
      }${newline}${s.strings.transaction_details_exchange_source_wallet}: ${guiWallet.name}${newline}${
        s.strings.fragment_send_from_label
      }: ${sourceAmount} ${symbolString}${newline}${s.strings.string_to_capitalize}: ${destinationAmount} ${destinationCurrencyCode}${newline}${
        s.strings.transaction_details_exchange_destination_wallet
      }: ${destinationWalletName}${newline}${isEstimate ? s.strings.estimated_quote : s.strings.fixed_quote}${newline}${newline}${
        s.strings.transaction_details_exchange_exchange_address
      }:${newline}  ${exchangeAddresses}${newline}${s.strings.transaction_details_exchange_exchange_unique_id}:${newline}  ${uniqueIdentifier}${newline}${
        s.strings.transaction_details_exchange_payout_address
      }:${newline}  ${payoutAddress}${newline}${s.strings.transaction_details_exchange_refund_address}:${newline}  ${refundAddress || ''}${newline}`
    }

    const openExchangeDetails = () => {
      Airship.show(bridge => (
        <RawTextModal
          bridge={bridge}
          body={createExchangeDataString()}
          title={s.strings.transaction_details_exchange_details}
          icon={<FontAwesomeIcon name="exchange" size={theme.rem(1.5)} color={theme.tileBackground} />}
        />
      ))
    }

    const openUrl = () => {
      const url = swapData.orderUri
      if (Platform.OS === 'ios') {
        return SafariView.isAvailable()
          .then(SafariView.show({ url }))
          .catch(error => {
            Linking.openURL(url)
            console.log(error)
          })
      }
      Linking.openURL(url)
    }

    const openEmail = () => {
      const email = swapData.plugin.supportEmail
      const body = createExchangeDataString('<br />')

      Mailer.mail(
        {
          subject: sprintf(s.strings.transaction_details_exchange_support_request, swapData.plugin.displayName),
          recipients: [email],
          body,
          isHTML: true
        },
        (error, event) => {
          if (error) showError(error)
        }
      )
    }

    return (
      <>
        <Tile type="touchable" title={s.strings.transaction_details_exchange_details} onPress={openExchangeDetails}>
          <View style={styles.tileColumn}>
            <EdgeText style={styles.tileTextBottom}>{s.strings.title_exchange + ' ' + sourceAmount + ' ' + symbolString}</EdgeText>
            <EdgeText style={styles.tileTextBottom}>{s.strings.string_to_capitalize + ' ' + destinationAmount + ' ' + destinationCurrencyCode}</EdgeText>
            <EdgeText style={styles.tileTextBottom}>{swapData.isEstimate ? s.strings.estimated_quote : s.strings.fixed_quote}</EdgeText>
          </View>
        </Tile>
        {swapData.orderUri && <Tile type="touchable" title={s.strings.transaction_details_exchange_status_page} onPress={openUrl} body={swapData.orderUri} />}
        {swapData.plugin.supportEmail && (
          <Tile type="touchable" title={s.strings.transaction_details_exchange_support} onPress={openEmail} body={swapData.plugin.supportEmail} />
        )}
      </>
    )
  }

  onSaveTxDetails = () => {
    const { payeeName, notes, bizId, miscJson, category, subCategory, amountFiat } = this.state
    const { edgeTransaction } = this.props
    let finalAmountFiat
    const fullCategory = category ? `${UTILS.capitalize(category)}:${subCategory}` : undefined
    const decimalAmountFiat = Number.parseFloat(amountFiat.replace(',', '.'))
    if (isNaN(decimalAmountFiat)) {
      // if invalid number set to previous saved amountFiat
      finalAmountFiat = edgeTransaction.metadata ? edgeTransaction.metadata.amountFiat : 0.0
    } else {
      // if a valid number or empty string then set to zero (empty) or actual number
      finalAmountFiat = !amountFiat ? 0.0 : decimalAmountFiat
    }
    edgeTransaction.metadata = { name: payeeName, category: fullCategory, notes, amountFiat: finalAmountFiat, bizId, miscJson }
    this.props.setTransactionDetails(edgeTransaction, edgeTransaction.metadata)
  }

  // Crypto Amount Logic
  getReceivedCryptoAmount(): FiatCryptoAmountUI {
    const { edgeTransaction, walletDefaultDenomProps, guiWallet } = this.props

    const absoluteAmount = abs(edgeTransaction.nativeAmount)
    const convertedAmount = UTILS.convertNativeToDisplay(walletDefaultDenomProps.multiplier)(absoluteAmount)
    const currencyName = guiWallet.currencyNames[edgeTransaction.currencyCode]
    const symbolString =
      UTILS.isCryptoParentCurrency(guiWallet, edgeTransaction.currencyCode) && walletDefaultDenomProps.symbol ? walletDefaultDenomProps.symbol : ''

    return {
      amountString: convertedAmount,
      symbolString,
      currencyName,
      feeString: ''
    }
  }

  getSentCryptoAmount(): FiatCryptoAmountUI {
    const { edgeTransaction, walletDefaultDenomProps, guiWallet } = this.props

    const absoluteAmount = abs(edgeTransaction.nativeAmount)
    const symbolString =
      UTILS.isCryptoParentCurrency(guiWallet, edgeTransaction.currencyCode) && walletDefaultDenomProps.symbol ? walletDefaultDenomProps.symbol : ''
    const currencyName = guiWallet.currencyNames[edgeTransaction.currencyCode]

    if (edgeTransaction.networkFee) {
      const convertedAmount = UTILS.convertNativeToDisplay(walletDefaultDenomProps.multiplier)(absoluteAmount)
      const convertedFee = UTILS.convertNativeToDisplay(walletDefaultDenomProps.multiplier)(edgeTransaction.networkFee)
      const amountMinusFee = sub(convertedAmount, convertedFee)

      const feeAbsolute = abs(UTILS.truncateDecimals(convertedFee, 6))
      const feeString = symbolString
        ? sprintf(s.strings.fragment_tx_detail_mining_fee_with_symbol, feeAbsolute)
        : sprintf(s.strings.fragment_tx_detail_mining_fee_with_denom, feeAbsolute, walletDefaultDenomProps.name)
      return {
        amountString: amountMinusFee,
        symbolString,
        currencyName,
        feeString
      }
    } else {
      return {
        amountString: absoluteAmount,
        symbolString,
        currencyName,
        feeString: ''
      }
    }
  }

  // Exchange Rate Fiat
  getCurrentFiat(): FiatCurrentAmountUI {
    const { currentFiatAmount } = this.props
    const { amountFiat } = this.state

    const amount = currentFiatAmount ? parseFloat(currentFiatAmount).toFixed(2).toString() : '0'
    const fiatAmount = amountFiat.replace(',', '.')
    const difference = amount ? parseFloat(amount) - parseFloat(fiatAmount) : 0
    const percentageFloat = amount && parseFloat(fiatAmount) > 0 ? (difference / parseFloat(fiatAmount)) * 100 : 0
    const percentage = bns.toFixed(percentageFloat.toString(), 2, 2)

    return {
      amount,
      difference,
      percentage: bns.abs(percentage)
    }
  }

  // Render
  render() {
    const { guiWallet, edgeTransaction, theme } = this.props
    const { direction, amountFiat, payeeName, thumbnailPath, notes, category, subCategory } = this.state
    const { fiatCurrencyCode } = guiWallet
    const styles = getStyles(theme)

    const crypto: FiatCryptoAmountUI = direction === 'receive' ? this.getReceivedCryptoAmount() : this.getSentCryptoAmount()
    const fiatSymbol = UTILS.getFiatSymbol(guiWallet.fiatCurrencyCode)
    const fiatValue = UTILS.truncateDecimals(amountFiat.replace('-', ''), 2, true)
    const currentFiat: FiatCurrentAmountUI = this.getCurrentFiat()
    const personLabel = direction === 'receive' ? s.strings.transaction_details_sender : s.strings.transaction_details_recipient
    const personName = payeeName && payeeName !== '' ? this.state.payeeName : personLabel
    const personHeader = sprintf(s.strings.transaction_details_person_name, personLabel)

    // spendTargets recipient addresses format
    let recipientsAddresses = ''
    if (edgeTransaction.spendTargets) {
      const { spendTargets } = edgeTransaction
      for (let i = 0; i < spendTargets.length; i++) {
        const newLine = i + 1 < spendTargets.length ? '\n' : ''
        recipientsAddresses = `${recipientsAddresses}${spendTargets[i].publicAddress}${newLine}`
      }
    }

    const specialCurrencyInfo = edgeTransaction.wallet ? Constants.getSpecialCurrencyInfo(edgeTransaction.wallet.currencyInfo.currencyCode) : undefined
    // A transaction is acceleratable when it's unconfirmed and has a recorded nonce
    const isAcceleratable = !!(
      edgeTransaction.spendTargets?.length &&
      specialCurrencyInfo?.isRbfSupported &&
      edgeTransaction.blockHeight === 0 &&
      edgeTransaction.otherParams?.nonceUsed
    )

    return (
      <SceneWrapper background="theme">
        <ScrollView>
          <View style={styles.tilesContainer}>
            <Tile type="editable" title={personHeader} onPress={this.openPersonInput}>
              <View style={styles.tileRow}>
                {thumbnailPath ? (
                  <Image style={styles.tileThumbnail} source={{ uri: thumbnailPath }} />
                ) : (
                  <IonIcon style={styles.tileAvatarIcon} name="person" size={theme.rem(2)} />
                )}
                <EdgeText style={styles.tileTextBottom}>{personName}</EdgeText>
              </View>
            </Tile>
            <Tile
              type="static"
              title={sprintf(s.strings.transaction_details_crypto_amount, crypto.currencyName)}
              body={`${crypto.symbolString} ${crypto.amountString}${crypto.feeString ? ` (${crypto.feeString})` : ''}`}
            />
            <Tile type="editable" title={sprintf(s.strings.transaction_details_amount_in_fiat, fiatCurrencyCode)} onPress={this.openFiatInput}>
              <View style={styles.tileRow}>
                <EdgeText style={styles.tileTextBottom}>{fiatSymbol + ' '}</EdgeText>
                <EdgeText style={styles.tileTextBottom}>{fiatValue}</EdgeText>
              </View>
            </Tile>
            <Tile type="static" title={s.strings.transaction_details_amount_current_price}>
              <View style={styles.tileRow}>
                <EdgeText style={styles.tileTextBottom}>{fiatSymbol + ' '}</EdgeText>
                <EdgeText style={styles.tileTextPrice}>{currentFiat.amount}</EdgeText>
                <EdgeText style={parseFloat(currentFiat.difference) >= 0 ? styles.tileTextPriceChangeUp : styles.tileTextPriceChangeDown}>
                  {(parseFloat(currentFiat.difference) >= 0 ? currentFiat.percentage : `- ${currentFiat.percentage}`) + '%'}
                </EdgeText>
              </View>
            </Tile>
            <Tile type="editable" title={s.strings.transaction_details_category_title} onPress={this.openCategoryInput}>
              <View style={styles.tileRow}>
                <View style={styles.tileCategory}>
                  <EdgeText style={styles.tileCategoryText}>{categories[category].syntax}</EdgeText>
                </View>
                <EdgeText style={styles.tileSubCategoryText}>{subCategory}</EdgeText>
              </View>
            </Tile>
            {edgeTransaction.spendTargets && <Tile type="copy" title={s.strings.transaction_details_recipient_addresses} body={recipientsAddresses} />}
            {this.renderExchangeData(crypto.symbolString)}
            {isAcceleratable && <Tile type="touchable" title={s.strings.transaction_details_advance_details_accelerate} onPress={this.openAccelerateModel} />}
            <Tile type="editable" title={s.strings.transaction_details_notes_title} body={notes} onPress={this.openNotesInput} />
            <TouchableWithoutFeedback onPress={this.openAdvancedDetails}>
              <EdgeText style={styles.textAdvancedTransaction}>{s.strings.transaction_details_view_advanced_data}</EdgeText>
            </TouchableWithoutFeedback>
            <PrimaryButton onPress={this.onSaveTxDetails} label={s.strings.string_save} marginRem={[0, 2, 2]} />
          </View>
        </ScrollView>
      </SceneWrapper>
    )
  }
}

const getStyles = cacheStyles((theme: Theme) => ({
  tilesContainer: {
    flex: 1,
    width: '100%',
    flexDirection: 'column'
  },
  tileRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  tileColumn: {
    flexDirection: 'column',
    justifyContent: 'center'
  },
  tileTextBottom: {
    color: theme.primaryText,
    fontSize: theme.rem(1)
  },
  tileAvatarIcon: {
    color: theme.primaryText,
    marginRight: theme.rem(0.5)
  },
  tileThumbnail: {
    width: theme.rem(2),
    height: theme.rem(2),
    borderRadius: theme.rem(1),
    marginRight: theme.rem(0.5)
  },
  tileTextPrice: {
    flex: 1,
    color: theme.primaryText,
    fontSize: theme.rem(1)
  },
  tileTextPriceChangeUp: {
    color: theme.positiveText,
    fontSize: theme.rem(1)
  },
  tileTextPriceChangeDown: {
    color: theme.negativeText,
    fontSize: theme.rem(1)
  },
  tileCategory: {
    height: theme.rem(2),
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.rem(0.5),
    marginVertical: theme.rem(0.25),
    borderWidth: 1,
    borderColor: theme.secondaryButtonOutline,
    borderRadius: 3
  },
  tileCategoryText: {
    color: theme.secondaryButtonText,
    fontSize: theme.rem(1)
  },
  tileSubCategoryText: {
    marginVertical: theme.rem(0.25),
    marginHorizontal: theme.rem(0.75),
    color: theme.primaryText
  },
  textAdvancedTransaction: {
    color: theme.textLink,
    marginVertical: theme.rem(1.25),
    fontSize: theme.rem(1),
    width: '100%',
    textAlign: 'center'
  }
}))

export const TransactionDetailsScene = connect(
  (state: RootState, ownProps: OwnProps): StateProps => {
    const { edgeTransaction } = ownProps
    const walletId = edgeTransaction.wallet ? edgeTransaction.wallet.id : null
    const wallet = walletId ? getWallet(state, walletId) : getSelectedWallet(state)
    const contacts = state.contacts
    const subcategoriesList = state.ui.scenes.transactionDetails.subcategories.sort()
    const settings = getSettings(state)
    const currencyCode = edgeTransaction.currencyCode
    const plugins = getPlugins(state)
    const allCurrencyInfos = plugins.allCurrencyInfos
    const currencyInfo = UTILS.getCurrencyInfo(allCurrencyInfos, currencyCode)
    const walletDefaultDenomProps: EdgeDenomination = UTILS.isCryptoParentCurrency(wallet, edgeTransaction.currencyCode)
      ? UTILS.getWalletDefaultDenomProps(wallet, settings)
      : UTILS.getWalletDefaultDenomProps(wallet, settings, edgeTransaction.currencyCode)

    const nativeAmount = edgeTransaction && edgeTransaction.nativeAmount ? bns.abs(edgeTransaction.nativeAmount) : ''
    const cryptoAmount = convertNativeToExchangeRateDenomination(settings, currencyCode, nativeAmount)
    const currentFiatAmount = convertCurrencyFromExchangeRates(state.exchangeRates, currencyCode, wallet.isoFiatCurrencyCode, parseFloat(cryptoAmount))

    const { swapData } = edgeTransaction
    if (swapData != null && typeof swapData.payoutCurrencyCode === 'string') {
      swapData.payoutCurrencyCode = swapData.payoutCurrencyCode.toUpperCase()
    }

    const destinationDenomination = swapData ? getDisplayDenomination(state, swapData.payoutCurrencyCode) : undefined
    const destinationWallet = swapData ? getWallet(state, swapData.payoutWalletId) : undefined

    return {
      contacts,
      currencyCode,
      currencyInfo,
      currentFiatAmount,
      destinationDenomination,
      destinationWallet,
      guiWallet: wallet,
      subcategoriesList,
      walletDefaultDenomProps
    }
  },
  (dispatch: Dispatch): DispatchProps => ({
    getSubcategories() {
      dispatch(getSubcategories())
    },
    setNewSubcategory(newSubcategory: string) {
      dispatch(setNewSubcategory(newSubcategory))
    },
    setTransactionDetails(transaction: EdgeTransaction, edgeMetadata: EdgeMetadata) {
      dispatch(setTransactionDetails(transaction, edgeMetadata))
    }
  })
)(withTheme(TransactionDetailsComponent))
