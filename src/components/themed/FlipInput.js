// @flow

import Clipboard from '@react-native-community/clipboard'
import { bns } from 'biggystring'
import * as React from 'react'
import { type Event, Animated, Image, Platform, TextInput, TouchableWithoutFeedback, View } from 'react-native'
import Menu, { MenuOption, MenuOptions, MenuTrigger, renderers } from 'react-native-popup-menu'
import MaterialIcon from 'react-native-vector-icons/MaterialIcons'

import { formatNumberInput, prettifyNumber, truncateDecimals, truncateDecimalsPeriod } from '../../locales/intl.js'
import s from '../../locales/strings.js'
import * as UTILS from '../../util/utils.js'
import { showError } from '../services/AirshipInstance.js'
import { type Theme, type ThemeProps, cacheStyles, withTheme } from '../services/ThemeContext.js'
import { EdgeText } from './EdgeText.js'
import { RightChevronButton } from './ThemedButtons.js'

export type FlipInputFieldInfo = {
  currencyName: string,
  currencySymbol: string, // currency symbol of field
  currencyCode: string, // 3-5 digit currency code

  // Maximum number of decimals to allow the user to enter. FlipInput will automatically truncate use input to this
  // number of decimals as the user types.
  maxEntryDecimals: number,

  // Maximum number of decimals to convert from the opposite field to this field.
  // ie If the user is typing into the fiat field, and this FlipInputFieldInfo refers to a BTC field, then this is the number of
  // decimals to use when converting the fiat value into this crypto field.
  maxConversionDecimals: number
}

type State = {
  isToggled: boolean,
  textInputFrontFocus: boolean,
  textInputBackFocus: boolean,
  overridePrimaryDecimalAmount: string,
  forceUpdateGuiCounter: number,
  primaryDisplayAmount: string, // Actual display amount including 1000s separator and localized for region
  secondaryDisplayAmount: string, // Actual display amount including 1000s separator and localized for region
  primaryDecimalAmount: string,
  secondaryDecimalAmount: string,
  rerenderCounter: number
}

export type FlipInputOwnProps = {
  // Override value of the primary field. This will be the initial value of the primary field. Only changes to this value will
  // cause changes to the primary field
  overridePrimaryDecimalAmount: string,

  // Exchange rate
  exchangeSecondaryToPrimaryRatio: string,

  // Information regarding the primary and secondary field. Mostly related to currency name, code, and denominations
  primaryInfo: FlipInputFieldInfo,
  secondaryInfo: FlipInputFieldInfo,
  onNext?: () => void,
  forceUpdateGuiCounter: number,

  // Callback when primaryDecimalAmount changes. **This is only called when the user types into a field or if
  // exchangeSecondaryToPrimaryRatio changes. This does NOT get called when overridePrimaryDecimalAmount is changed by the parent
  onAmountChanged(decimalAmount: string): void,
  isEditable: boolean,
  isFiatOnTop: boolean,
  isFocus: boolean,

  topReturnKeyType?: string,
  inputAccessoryViewID?: string,
  headerText: string,
  headerLogo: string | void,
  headerCallback?: () => void,
  keyboardVisible: boolean
}

type Props = FlipInputOwnProps & ThemeProps

type Amounts = {
  primaryDecimalAmount: string,
  primaryDisplayAmount: string,
  secondaryDecimalAmount: string,
  secondaryDisplayAmount: string
}

export const sanitizeDecimalAmount = (amount: string, maxEntryDecimals: number): string => {
  // Replace all commas into periods
  amount = amount.replace(',', '.')

  // Remove characters except numbers and decimal separator
  amount = amount.replace(/[^0-9.]/g, '')

  // Trunctuate decimals to limited decimal entries, also remove additional periods
  return truncateDecimalsPeriod(amount, maxEntryDecimals)
}

const checkKeyPress = (keyPressed: string, decimalAmount: string) => {
  if (keyPressed === '.' && decimalAmount.includes('.')) {
    return false
  }

  if (keyPressed.match(/[^0-9.]/)) {
    return false
  }

  return true
}

// Assumes a US locale decimal input
const setPrimaryToSecondary = (props: Props, primaryDecimalAmount: string): Amounts => {
  // Formats into locale specific format. Add currency symbol
  const primaryDisplayAmount = formatNumberInput(prettifyNumber(primaryDecimalAmount))

  // Converts to secondary value using exchange rate
  let secondaryDecimalAmount = bns.mul(primaryDecimalAmount, props.exchangeSecondaryToPrimaryRatio)

  // Truncate to however many decimals the secondary format should have
  secondaryDecimalAmount = UTILS.truncateDecimals(secondaryDecimalAmount, props.secondaryInfo.maxConversionDecimals)

  // Format into locale specific format. Add currency symbol
  const secondaryDisplayAmount = formatNumberInput(prettifyNumber(secondaryDecimalAmount))

  // Set the state for display in render()
  return { primaryDecimalAmount, primaryDisplayAmount, secondaryDecimalAmount, secondaryDisplayAmount }
}

// Pretty much the same as setPrimaryToSecondary
const setSecondaryToPrimary = (props: Props, secondaryDecimalAmount: string): Amounts => {
  const secondaryDisplayAmount = formatNumberInput(prettifyNumber(secondaryDecimalAmount))
  let primaryDecimalAmount = props.exchangeSecondaryToPrimaryRatio === '0' ? '0' : bns.div(secondaryDecimalAmount, props.exchangeSecondaryToPrimaryRatio, 18)
  primaryDecimalAmount = UTILS.truncateDecimals(primaryDecimalAmount, props.primaryInfo.maxConversionDecimals)
  const primaryDisplayAmount = formatNumberInput(prettifyNumber(primaryDecimalAmount))
  return { primaryDisplayAmount, primaryDecimalAmount, secondaryDisplayAmount, secondaryDecimalAmount }
}

const getInitialState = (props: Props) => {
  const state: State = {
    isToggled: false,
    textInputFrontFocus: false,
    textInputBackFocus: false,
    overridePrimaryDecimalAmount: '',
    primaryDisplayAmount: '',
    forceUpdateGuiCounter: 0,
    secondaryDisplayAmount: '',
    primaryDecimalAmount: '',
    secondaryDecimalAmount: '',
    rerenderCounter: 0
  }

  if (props.overridePrimaryDecimalAmount === '') return state

  const primaryDecimalAmount = sanitizeDecimalAmount(props.overridePrimaryDecimalAmount, props.primaryInfo.maxEntryDecimals)
  return Object.assign(state, setPrimaryToSecondary(props, primaryDecimalAmount))
}

class FlipInputComponent extends React.PureComponent<Props, State> {
  animatedValue: Animated.Value
  frontInterpolate: Animated.Value
  backInterpolate: Animated.Value
  androidFrontOpacityInterpolate: Animated.Value
  androidBackOpacityInterpolate: Animated.Value
  textInputFront: TextInput | null
  textInputBack: TextInput | null
  clipboardMenu: any

  constructor(props: Props) {
    super(props)
    this.state = getInitialState(props)

    // Mounting Animation
    this.animatedValue = new Animated.Value(0)
    this.frontInterpolate = this.animatedValue.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '180deg']
    })

    this.backInterpolate = this.animatedValue.interpolate({
      inputRange: [0, 1],
      outputRange: ['180deg', '360deg']
    })
    this.androidFrontOpacityInterpolate = this.animatedValue.interpolate({
      inputRange: [0, 0.5, 0.5],
      outputRange: [1, 1, 0]
    })
    this.androidBackOpacityInterpolate = this.animatedValue.interpolate({
      inputRange: [0.5, 0.5, 1],
      outputRange: [0, 1, 1]
    })
  }

  componentDidMount() {
    setTimeout(() => {
      if (this.props.keyboardVisible && this.props.overridePrimaryDecimalAmount === '0' && this.textInputFront) {
        this.textInputFront.focus()
      }
    }, 400)

    if (this.props.isFiatOnTop) {
      this.setState({
        isToggled: !this.state.isToggled
      })
      Animated.timing(this.animatedValue, {
        toValue: 1,
        duration: 0
      }).start()
      setTimeout(() => {
        this.setState({
          secondaryDisplayAmount: ''
        })
      }, 10)
    }

    if (this.props.isFocus) {
      setTimeout(() => {
        if (this.state.isToggled) {
          const { exchangeSecondaryToPrimaryRatio } = this.props
          if (bns.eq(exchangeSecondaryToPrimaryRatio, '0') || exchangeSecondaryToPrimaryRatio === '') {
            this.toggleCryptoOnTop()
          } else {
            this.textInputBack && this.textInputBack.focus()
          }
        } else {
          this.textInputFront && this.textInputFront.focus()
        }
      }, 650)
    }
  }

  UNSAFE_componentWillReceiveProps(nextProps: Props) {
    // Check if primary changed first. Don't bother to check secondary if parent passed in a primary
    if (
      nextProps.overridePrimaryDecimalAmount !== this.state.overridePrimaryDecimalAmount ||
      nextProps.forceUpdateGuiCounter !== this.state.forceUpdateGuiCounter
    ) {
      const result = setPrimaryToSecondary(nextProps, sanitizeDecimalAmount(nextProps.overridePrimaryDecimalAmount, nextProps.primaryInfo.maxEntryDecimals))
      this.setState({
        ...result,
        overridePrimaryDecimalAmount: nextProps.overridePrimaryDecimalAmount,
        forceUpdateGuiCounter: nextProps.forceUpdateGuiCounter
      })
    } else {
      // Checks and apply exchange rates
      if (!this.state.isToggled) {
        this.setState(setPrimaryToSecondary(nextProps, this.state.primaryDecimalAmount))
      } else {
        this.setState(setSecondaryToPrimary(nextProps, this.state.secondaryDecimalAmount))
      }
    }
    if (nextProps.primaryInfo.currencyCode !== this.props.primaryInfo.currencyCode) {
      setTimeout(() => this.onKeyPress('0', '', this.props.primaryInfo.maxEntryDecimals, setPrimaryToSecondary), 50)
    }
  }

  toggleCryptoOnTop = () => {
    if (this.state.isToggled) {
      this.onToggleFlipInput()
    }
  }

  onToggleFlipInput = () => {
    this.clipboardMenu.close()
    this.setState({
      isToggled: !this.state.isToggled
    })
    if (this.state.isToggled) {
      if (this.textInputFront) {
        this.textInputFront.focus()
      }
      Animated.spring(this.animatedValue, {
        toValue: 0,
        friction: 8,
        tension: 10
      }).start()
    }
    if (!this.state.isToggled) {
      if (this.textInputBack) {
        this.textInputBack.focus()
      }
      Animated.spring(this.animatedValue, {
        toValue: 1,
        friction: 8,
        tension: 10
      }).start()
    }
  }

  async openClipboardMenu() {
    this.clipboardMenu.close()
    try {
      if ((this.state.textInputFrontFocus || this.state.textInputBackFocus) && (await Clipboard.getString())) {
        this.clipboardMenu.open()
      }
    } catch (error) {
      showError(error)
    }
  }

  textInputTopFocus = () => {
    if (this.state.isToggled) {
      if (this.textInputBack) {
        this.textInputBack.focus()
      }
    } else {
      if (this.textInputFront) {
        this.textInputFront.focus()
      }
    }
  }

  textInputTopBlur = () => {
    if (this.state.isToggled) {
      if (this.textInputBack) {
        this.textInputBack.blur()
      }
    } else {
      if (this.textInputFront) {
        this.textInputFront.blur()
      }
    }
  }

  getTextInputFrontRef = (ref: TextInput | null) => {
    this.textInputFront = ref
  }

  textInputFrontFocusTrue = () => {
    this.setState({ textInputFrontFocus: true, rerenderCounter: this.state.rerenderCounter + 1 })
  }

  textInputFrontFocusFalse = () => {
    this.setState({ textInputFrontFocus: false })
  }

  textInputFrontFocus = async () => {
    this.openClipboardMenu()
    if (this.textInputFront) {
      this.textInputFront.focus()
    }
  }

  onKeyPress(keyPressed: string, decimalAmount: string, maxEntryDecimals: number, setAmounts: (Props, string) => Amounts) {
    keyPressed = keyPressed.replace(',', '.')
    if (keyPressed === 'Backspace') {
      this.setStateAmounts(truncateDecimals(decimalAmount.slice(0, -1), maxEntryDecimals), setAmounts)
    } else if (checkKeyPress(keyPressed, decimalAmount)) {
      this.setStateAmounts(truncateDecimals(decimalAmount + keyPressed, maxEntryDecimals), setAmounts)
    }
  }

  setStateAmounts(decimalAmount: string, setAmounts: (Props, string) => Amounts) {
    const amounts = setAmounts(this.props, decimalAmount)
    this.setState(amounts, () => this.props.onAmountChanged(amounts.primaryDecimalAmount))
  }

  onPrimaryChangeText = (value: string) => {
    // Hack on android where to only get the number farthest to the right
    if (Platform.OS === 'ios') return
    if (value.match(/[^0-9]/)) return
    this.onKeyPress(value.slice(value.length - 1), this.state.primaryDecimalAmount, this.props.primaryInfo.maxEntryDecimals, setPrimaryToSecondary)
  }

  onPrimaryKeyPress = (e: Event) => {
    if (Platform.OS === 'android' && e.nativeEvent.key.match(/[0-9]/)) return
    this.onKeyPress(e.nativeEvent.key, this.state.primaryDecimalAmount, this.props.primaryInfo.maxEntryDecimals, setPrimaryToSecondary)
  }

  topRowFront = () => {
    const { theme } = this.props
    const styles = getStyles(theme)
    const { primaryDisplayAmount, primaryDecimalAmount } = this.state
    const displayAmountCheck = !primaryDecimalAmount || primaryDecimalAmount.match(/^0*$/)
    const displayAmountString = displayAmountCheck ? s.strings.string_enter_amount : primaryDisplayAmount
    const displayAmountStyle = displayAmountCheck ? styles.topAmountMuted : styles.topAmount

    return (
      <TouchableWithoutFeedback onPress={this.textInputFrontFocus}>
        <View style={styles.topContainer} key="top">
          <EdgeText style={displayAmountStyle}>{displayAmountString}</EdgeText>
          {!displayAmountCheck && <EdgeText style={styles.topCurrency}>{this.props.primaryInfo.currencyCode}</EdgeText>}
          <TextInput
            style={styles.hiddenTextInput}
            value=""
            onChangeText={this.onPrimaryChangeText}
            onKeyPress={this.onPrimaryKeyPress}
            autoCorrect={false}
            keyboardType="numeric"
            returnKeyType={this.props.topReturnKeyType || 'done'}
            ref={this.getTextInputFrontRef}
            onFocus={this.textInputFrontFocusTrue}
            onBlur={this.textInputFrontFocusFalse}
            editable={this.props.isEditable}
            onSubmitEditing={this.props.onNext}
            inputAccessoryViewID={this.props.inputAccessoryViewID || null}
          />
        </View>
      </TouchableWithoutFeedback>
    )
  }

  getTextInputBackRef = (ref: TextInput | null) => {
    this.textInputBack = ref
  }

  textInputBackFocusTrue = () => {
    this.setState({ textInputBackFocus: true })
  }

  textInputBackFocusFalse = () => {
    this.setState({ textInputBackFocus: false })
  }

  textInputBackFocus = async () => {
    this.openClipboardMenu()
    if (this.textInputBack) {
      this.textInputBack.focus()
    }
  }

  onSecondaryChangeText = (value: string) => {
    // Hack on android where to only get the number farthest to the right
    if (Platform.OS === 'ios') return
    if (value.match(/[^0-9]/)) return
    this.onKeyPress(value.slice(value.length - 1), this.state.secondaryDecimalAmount, this.props.secondaryInfo.maxEntryDecimals, setSecondaryToPrimary)
  }

  onSecondaryKeyPress = (e: Event) => {
    if (Platform.OS === 'android' && e.nativeEvent.key.match(/[0-9]/)) return
    this.onKeyPress(e.nativeEvent.key, this.state.secondaryDecimalAmount, this.props.secondaryInfo.maxEntryDecimals, setSecondaryToPrimary)
  }

  topRowBack = () => {
    const { theme } = this.props
    const styles = getStyles(theme)
    const { secondaryDisplayAmount, secondaryDecimalAmount } = this.state
    const displayAmountCheck = !secondaryDecimalAmount || secondaryDecimalAmount.match(/^0*$/)
    const displayAmountString = displayAmountCheck ? s.strings.string_enter_amount : secondaryDisplayAmount
    const displayAmountStyle = displayAmountCheck ? styles.topAmountMuted : styles.topAmount

    return (
      <TouchableWithoutFeedback onPress={this.textInputBackFocus}>
        <View style={styles.topContainer} key="top">
          <EdgeText style={displayAmountStyle}>{displayAmountString}</EdgeText>
          {!displayAmountCheck && <EdgeText style={styles.topCurrency}>{this.props.secondaryInfo.currencyName}</EdgeText>}
          <TextInput
            style={styles.hiddenTextInput}
            value=""
            onChangeText={this.onSecondaryChangeText}
            onKeyPress={this.onSecondaryKeyPress}
            autoCorrect={false}
            keyboardType="numeric"
            returnKeyType={this.props.topReturnKeyType || 'done'}
            ref={this.getTextInputBackRef}
            onFocus={this.textInputBackFocusTrue}
            onBlur={this.textInputBackFocusFalse}
            editable={this.props.isEditable}
            onSubmitEditing={this.props.onNext}
            inputAccessoryViewID={this.props.inputAccessoryViewID || null}
          />
        </View>
      </TouchableWithoutFeedback>
    )
  }

  bottomRow = (fieldInfo: FlipInputFieldInfo, amount: string) => {
    const bottomText = `${amount} ${fieldInfo.currencyCode}`
    return (
      <TouchableWithoutFeedback onPress={this.onToggleFlipInput} key="bottom">
        <EdgeText>{bottomText}</EdgeText>
      </TouchableWithoutFeedback>
    )
  }

  handlePasteClipboard = async () => {
    try {
      const clipboard = await Clipboard.getString()
      if (this.state.isToggled) {
        this.setStateAmounts('', setSecondaryToPrimary)
        for (const string of clipboard.split('')) {
          this.onKeyPress(string, this.state.secondaryDecimalAmount, this.props.secondaryInfo.maxEntryDecimals, setSecondaryToPrimary)
        }
      } else {
        this.setStateAmounts('', setSecondaryToPrimary)
        for (const string of clipboard.split('')) {
          this.onKeyPress(string, this.state.primaryDecimalAmount, this.props.primaryInfo.maxEntryDecimals, setPrimaryToSecondary)
        }
      }
    } catch (error) {
      showError(error)
    }
  }

  clipboardRef = (ref: any) => (this.clipboardMenu = ref)

  handleWalletPress = () => {}

  render() {
    const { primaryInfo, secondaryInfo, headerText, headerLogo, headerCallback, theme } = this.props
    const { isToggled } = this.state
    const frontAnimatedStyle = { transform: [{ rotateX: this.frontInterpolate }] }
    const backAnimatedStyle = { transform: [{ rotateX: this.backInterpolate }] }
    const styles = getStyles(theme)

    return (
      <View style={styles.container}>
        <View style={styles.headerContainer}>
          <Image style={styles.headerIcon} source={{ uri: headerLogo || '' }} />
          <RightChevronButton text={headerText} onPress={headerCallback || this.handleWalletPress} />
        </View>
        <View style={styles.clipboardContainer}>
          <Menu onSelect={this.handlePasteClipboard} ref={this.clipboardRef} renderer={renderers.Popover} rendererProps={{ placement: 'top' }}>
            <MenuTrigger />
            <MenuOptions>
              <MenuOption>
                <EdgeText style={styles.clipboardText}>{s.strings.string_paste}</EdgeText>
              </MenuOption>
            </MenuOptions>
          </Menu>
        </View>
        <View style={styles.flipInputContainer}>
          <View style={styles.flipInput}>
            <Animated.View
              style={[styles.flipInputFront, frontAnimatedStyle, { opacity: this.androidFrontOpacityInterpolate }]}
              pointerEvents={isToggled ? 'none' : 'auto'}
            >
              {this.topRowFront()}
              {this.bottomRow(secondaryInfo, this.state.secondaryDisplayAmount)}
            </Animated.View>
            <Animated.View
              style={[styles.flipInputFront, styles.flipContainerBack, backAnimatedStyle, { opacity: this.androidBackOpacityInterpolate }]}
              pointerEvents={isToggled ? 'auto' : 'none'}
            >
              {this.topRowBack()}
              {this.bottomRow(primaryInfo, this.state.primaryDisplayAmount)}
            </Animated.View>
          </View>
          <MaterialIcon styles={styles.flipIcon} onPress={this.onToggleFlipInput} name="swap-vert" size={theme.rem(2)} color={theme.iconTappable} />
        </View>
      </View>
    )
  }
}

const getStyles = cacheStyles((theme: Theme) => ({
  container: {
    width: '100%'
  },

  // Header
  headerContainer: {
    flexDirection: 'row'
  },
  headerIcon: {
    width: theme.rem(1.5),
    height: theme.rem(1.5),
    marginRight: theme.rem(0.5)
  },

  // Flip Input
  flipInputContainer: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  flipInput: {
    flex: 1
  },
  flipInputFront: {
    backfaceVisibility: 'hidden'
  },
  flipContainerBack: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  },
  flipIcon: {
    paddingTop: theme.rem(0.25)
  },

  // Top Amount
  topContainer: {
    flexDirection: 'row'
  },
  topAmount: {
    fontFamily: theme.fontFaceBold,
    fontSize: theme.rem(2),
    marginLeft: theme.rem(-0.1), // Hack because of amount being bigger font size not aligning to the rest of the text on justified left
    marginRight: theme.rem(0.5)
  },
  topAmountMuted: {
    fontFamily: theme.fontFaceBold,
    fontSize: theme.rem(2),
    marginLeft: theme.rem(-0.1), // Hack because of amount being bigger font size not aligning to the rest of the text on justified left
    marginRight: theme.rem(0.5),
    color: theme.deactivatedText
  },
  topCurrency: {
    paddingTop: theme.rem(0.25)
  },
  hiddenTextInput: {
    position: 'absolute',
    width: 0,
    height: 0
  },

  // Clipboard Popup
  clipboardContainer: {
    height: 0,
    width: '8%',
    top: theme.rem(0.5),
    alignItems: 'flex-end'
  },
  clipboardText: {
    color: theme.clipboardPopupText,
    padding: theme.rem(0.25)
  }
}))

export const FlipInput = withTheme(FlipInputComponent)
